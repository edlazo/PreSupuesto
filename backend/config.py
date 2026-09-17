"""Application settings for the PreSupuesto backend.

Values are read from environment variables, falling back to the `.env` file
that sits next to this module. The `.env` file is resolved by absolute path so
the settings load identically from uvicorn, from the MCP server process that
Hermes Agent spawns, and from scripts.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    """Runtime configuration for the API, Supabase and Hermes Agent."""

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Supabase -----------------------------------------------------------
    # SUPABASE_KEY must be the service role key: the schema enables Row Level
    # Security without policies, so the anon key cannot read or write anything.
    supabase_url: str = ""
    supabase_key: str = ""

    # --- Hermes Agent -------------------------------------------------------
    # Base URL of the Hermes Agent OpenAI-compatible API server, started with
    # `hermes gateway` once API_SERVER_ENABLED and API_SERVER_KEY are set in
    # ~/.hermes/.env. The default port of that server is 8642.
    hermes_api_url: str = "http://127.0.0.1:8642/v1"
    hermes_api_key: str = ""
    hermes_model: str = "hermes-agent"
    hermes_timeout_seconds: float = 180.0

    # --- Gemini fallback ----------------------------------------------------
    # Used when the Hermes Agent gateway cannot be reached. The budgeting tools
    # then run in this process instead of inside Hermes.
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash"
    # Tried in order when the primary model answers 503 "high demand", which
    # happens to any single model from time to time.
    gemini_fallback_models: str = "gemini-3.5-flash-lite,gemini-3.1-flash-lite"
    gemini_timeout_seconds: float = 120.0

    # --- API ----------------------------------------------------------------
    # Comma-separated list of origins allowed by CORS.
    cors_origins: str = "http://localhost:3000"

    # --- Company details, printed on the budget PDF -------------------------
    company_name: str = "PreSupuesto"
    company_tax_id: str = ""
    company_address: str = ""
    company_email: str = ""
    company_phone: str = ""

    # --- Budget defaults ----------------------------------------------------
    default_currency: str = "EUR"
    default_tax_rate: float = 21.0

    @property
    def cors_origin_list(self) -> list[str]:
        """CORS origins as a list."""
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def supabase_configured(self) -> bool:
        """True when both Supabase credentials are present."""
        return bool(self.supabase_url and self.supabase_key)

    @property
    def hermes_configured(self) -> bool:
        """True when the Hermes Agent API server credentials are present."""
        return bool(self.hermes_api_url and self.hermes_api_key)

    @property
    def gemini_model_chain(self) -> list[str]:
        """The models to try, in order, on the fallback path."""
        chain = [self.gemini_model]
        chain.extend(
            model.strip() for model in self.gemini_fallback_models.split(",") if model.strip()
        )
        # Keep the order while dropping repeats.
        return list(dict.fromkeys(chain))

    @property
    def gemini_configured(self) -> bool:
        """True when the Gemini fallback can be used."""
        return bool(self.gemini_api_key)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the cached settings instance."""
    return Settings()


settings = get_settings()
