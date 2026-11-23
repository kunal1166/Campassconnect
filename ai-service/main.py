from fastapi import FastAPI, UploadFile, File, HTTPException
from PIL import Image
from transformers import CLIPModel, CLIPProcessor
import io
import torch

app = FastAPI(title="CampusConnect CLIP Embedding Service")
MODEL_NAME = "openai/clip-vit-base-patch32"
model = None
processor = None

@app.on_event("startup")
def load_model():
    global model, processor
    processor = CLIPProcessor.from_pretrained(MODEL_NAME)
    model = CLIPModel.from_pretrained(MODEL_NAME)
    model.eval()

@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME, "loaded": model is not None}

@app.post("/embed")
async def embed(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="An image file is required")
    try:
        image = Image.open(io.BytesIO(await file.read())).convert("RGB")
        inputs = processor(images=image, return_tensors="pt")
        with torch.no_grad():
            features = model.get_image_features(**inputs)
            features = features / features.norm(dim=-1, keepdim=True)
        return {"embedding": features[0].cpu().tolist(), "model": MODEL_NAME}
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not process image: {exc}") from exc
