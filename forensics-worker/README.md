# Forensics Math Worker (Python)

This microservice offloads the heavy $O(N^3)$ statistical matrices and Expectation-Maximization loops from the V8 JavaScript engine to Python using NumPy. This allows the World Monitor Forensics Shadow Pipeline to scale horizontally and evaluate thousands of signals simultaneously without blocking the Node/Edge runtime.

## Requirements

- Python 3.9+

## Installation

```bash
pip install fastapi uvicorn pydantic numpy
```

## Running the Worker

```bash
python main.py
```

The service will start on `http://localhost:8000`.

## Connecting to World Monitor

To route forensics math to this worker, set the following environment variable before starting your Vercel dev server or Tauri app:

```bash
export FORENSICS_WORKER_URL="http://localhost:8000"
```

The TypeScript application logic (`forensics-orchestrator.ts`) will automatically detect this variable and dispatch the heavy payload to `/internal/forensics/v1/fuse`.
