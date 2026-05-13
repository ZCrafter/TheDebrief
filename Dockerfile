FROM python:3.11-slim

WORKDIR /app

# Install deps first (cache layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY main.py .
COPY static/ ./static/

# Data directory (will be overridden by volume)
RUN mkdir -p /data

EXPOSE 5400

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5400"]
