from pathlib import Path
from uuid import uuid4

from flask import current_app
from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename


IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
DOCUMENT_EXTENSIONS = IMAGE_EXTENSIONS | {"pdf"}


def save_upload(file: FileStorage | None, kind="image"):
    if not file or not file.filename:
        return None
    safe_name = secure_filename(file.filename)
    if "." not in safe_name:
        raise ValueError("Uploaded file has no valid extension.")
    extension = safe_name.rsplit(".", 1)[1].lower()
    allowed = IMAGE_EXTENSIONS if kind == "image" else DOCUMENT_EXTENSIONS
    if extension not in allowed:
        raise ValueError(f"Only {', '.join(sorted(allowed))} files are accepted.")
    expected_prefix = "image/" if extension != "pdf" else "application/pdf"
    mimetype = (file.mimetype or "").lower()
    if extension == "pdf":
        if mimetype not in {"application/pdf", "application/x-pdf"}:
            raise ValueError("The uploaded document type is not allowed.")
    elif not mimetype.startswith(expected_prefix):
        raise ValueError("The uploaded image type is not allowed.")
    folder = Path(current_app.config["UPLOAD_FOLDER"])
    folder.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid4().hex}.{extension}"
    file.save(folder / stored_name)
    return stored_name
