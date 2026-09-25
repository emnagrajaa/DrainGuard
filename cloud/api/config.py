"""
Loads environment variables from .env (if present) once, at import
time, before anything else reads os.getenv(). Every other module
should import settings from here rather than calling load_dotenv()
itself.
"""
import os
from dotenv import load_dotenv

load_dotenv()  # reads .env in the current working directory, if present

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./drainguard.db")
OWM_API_KEY = os.getenv("OWM_API_KEY")
