from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import numpy as np

app = FastAPI()

class ForensicsSignalInput(BaseModel):
    sourceId: str
    region: Optional[str] = None
    domain: str
    signalType: str
    value: float
    confidence: Optional[float] = 1.0
    observedAt: Optional[int] = 0
    evidenceIds: Optional[List[str]] = []

class WorkerFuseRequest(BaseModel):
    domain: str
    signals: List[ForensicsSignalInput]
    alpha: float
    feedbackMap: Optional[Dict[str, bool]] = {}

def sigmoid(x):
    return np.where(x >= 0, 
                    1 / (1 + np.exp(-x)), 
                    np.exp(x) / (1 + np.exp(x)))

@app.post("/internal/forensics/v1/fuse")
def fuse(req: WorkerFuseRequest):
    signals = req.signals
    feedback_map = req.feedbackMap or {}
    
    if not signals:
        return {"fusedSignals": []}

    source_ids = list(dict.fromkeys(s.sourceId for s in signals))
    signal_types = list(dict.fromkeys(s.signalType for s in signals))
    
    source_index = {sid: i for i, sid in enumerate(source_ids)}
    type_index = {stype: i for i, stype in enumerate(signal_types)}
    
    n_sources = len(source_ids)
    n_types = len(signal_types)
    
    value_matrix = np.zeros((n_sources, n_types))
    domain_by_source = {}
    region_by_source = {}
    evidence_ids_by_source = {sid: set() for sid in source_ids}
    
    for s in signals:
        i = source_index[s.sourceId]
        j = type_index[s.signalType]
        value_matrix[i, j] += s.value
        domain_by_source[s.sourceId] = s.domain or 'infrastructure'
        region_by_source[s.sourceId] = s.region or 'global'
        if s.evidenceIds:
            evidence_ids_by_source[s.sourceId].update(s.evidenceIds)
            
    # Calculate thresholds (70th percentile)
    thresholds = np.zeros(n_types)
    for j in range(n_types):
        positives = value_matrix[:, j][value_matrix[:, j] > 0]
        if len(positives) > 0:
            thresholds[j] = np.percentile(positives, 70)
        else:
            thresholds[j] = np.inf
            
    # Label matrix
    label_matrix = np.zeros((n_sources, n_types))
    for i in range(n_sources):
        for j in range(n_types):
            val = value_matrix[i, j]
            if val <= 0 or not np.isfinite(val):
                label_matrix[i, j] = 0
            elif val >= thresholds[j]:
                label_matrix[i, j] = 1
            else:
                label_matrix[i, j] = -1
                
    # Propensities
    propensities = np.zeros(n_types)
    if n_sources > 0:
        for j in range(n_types):
            propensities[j] = np.sum(label_matrix[:, j] != 0) / n_sources
            
    # Dependency penalty (using numpy for speed)
    dependency_penalty = np.zeros(n_types)
    
    # We can do pairwise correlation efficiently
    # For overlap, just where both are non-zero
    for j in range(n_types):
        weighted_correlation = 0
        total_overlap = 0
        
        mask_j = label_matrix[:, j] != 0
        
        for k in range(n_types):
            if j == k: continue
            
            mask_k = label_matrix[:, k] != 0
            overlap_mask = mask_j & mask_k
            overlap = np.sum(overlap_mask)
            
            if overlap < 6: continue
            
            lj = label_matrix[overlap_mask, j]
            lk = label_matrix[overlap_mask, k]
            
            mean_j = np.mean(lj)
            mean_k = np.mean(lk)
            
            var_j = np.var(lj)
            var_k = np.var(lk)
            
            if var_j <= 1e-9 or var_k <= 1e-9: continue
            
            cov = np.mean(lj * lk) - mean_j * mean_k
            corr = cov / np.sqrt(var_j * var_k)
            redundancy = np.clip(corr, 0, 1)
            
            weighted_correlation += redundancy * overlap
            total_overlap += overlap
            
        if total_overlap > 0:
            dependency_penalty[j] = np.clip(weighted_correlation / total_overlap, 0, 0.95)
            
    accuracies = np.full(n_types, 0.7)
    class_prior = 0.5
    
    # Feedback
    feedback_labels = np.zeros((n_sources, n_types))
    has_feedback = np.zeros((n_sources, n_types), dtype=bool)
    
    for i, sid in enumerate(source_ids):
        for j, stype in enumerate(signal_types):
            if label_matrix[i, j] != 0:
                key = f"{sid}:{stype}"
                if key in feedback_map:
                    has_feedback[i, j] = True
                    feedback_labels[i, j] = 1.0 if feedback_map[key] else 0.0

    # EM Loop
    for iter in range(80):
        # E-step
        soft_labels = np.zeros(n_sources)
        for i in range(n_sources):
            # Check feedback
            source_has_feedback = False
            for j in range(n_types):
                if has_feedback[i, j]:
                    soft_labels[i] = feedback_labels[i, j]
                    source_has_feedback = True
                    break
                    
            if source_has_feedback:
                continue
                
            logit = np.log(max(1e-6, class_prior) / max(1e-6, 1 - class_prior))
            for j in range(n_types):
                label = label_matrix[i, j]
                if label == 0: continue
                
                a = np.clip(accuracies[j], 0.501, 0.999)
                prop = propensities[j]
                indep = 1 - (0.7 * dependency_penalty[j])
                vote_scale = np.clip(indep * (0.4 + (0.6 * prop)), 0.15, 1.0)
                
                odds = np.log(a / (1 - a)) * vote_scale
                logit += odds if label > 0 else -odds
                
            soft_labels[i] = sigmoid(logit)
            
        # M-step
        class_prior = np.clip(np.mean(soft_labels), 0.01, 0.99)
        
        for j in range(n_types):
            active_mask = label_matrix[:, j] != 0
            if not np.any(active_mask): continue
            
            p = soft_labels[active_mask]
            l = label_matrix[active_mask, j]
            
            match_prob = np.where(l > 0, p, 1 - p)
            expected_correct = np.sum(match_prob)
            total_active = np.sum(active_mask)
            
            accuracies[j] = np.clip(expected_correct / total_active, 0.4, 0.95)

    # Result formatting
    fused_signals = []
    for i, source_id in enumerate(source_ids):
        p = soft_labels[i]
        score = p * 100
        
        # Calculate confidence interval
        active_count = np.sum(label_matrix[i] != 0)
        margin = 1.96 * np.sqrt((p * (1 - p)) / max(1, active_count))
        
        # Get contributors
        contributors = []
        for j in range(n_types):
            if label_matrix[i, j] != 0:
                contributors.append({
                    "signalType": signal_types[j],
                    "contribution": float(abs(label_matrix[i, j]) * accuracies[j] * 100),
                    "learnedWeight": float(accuracies[j])
                })
                
        # Sort contributors by contribution
        contributors.sort(key=lambda x: x["contribution"], reverse=True)
                
        fused_signals.append({
            "sourceId": source_id,
            "region": region_by_source[source_id],
            "domain": domain_by_source[source_id],
            "probability": float(p),
            "score": float(score),
            "confidenceLower": float(max(0, p - margin)),
            "confidenceUpper": float(min(1, p + margin)),
            "contributors": contributors[:3],
            "evidenceIds": list(evidence_ids_by_source[source_id])
        })
        
    return {"fusedSignals": fused_signals}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
