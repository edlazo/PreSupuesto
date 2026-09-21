# Project: PreSupuesto (Hermes Agent & Supabase)

## Overview
PreSupuesto is a web application and intelligent assistant designed to automate construction and home renovation budget generation using Hermes Agent, backed by Supabase (PostgreSQL).

## Tech Stack
- **Backend:** Python (FastAPI), Hermes Agent SDK, Supabase Python SDK
- **Frontend:** Next.js (App Router), React, Tailwind CSS
- **Database:** PostgreSQL on Supabase

## Project Structure
- `/backend`: FastAPI server, API endpoints, Supabase services, and Hermes Agent skills.
- `/frontend`: Next.js web interface application.
- `/supabase`: Database schema and SQL migrations.

## Development Commands
- Run Backend: `cd backend && uvicorn main:app --host 0.0.0.0 --reload`
- Run Frontend: `cd frontend && npm run dev`

## Guidelines & Conventions
- Keep API responses strongly typed using Pydantic in FastAPI.
- All Supabase interactions must be handled in `backend/services/supabase_service.py`.
- **Commit Messages:** All git commits MUST start with one of these exact prefixes: `Feature:`, `Bugfix:`, `Documentation:`, `Refactor:`, or `Deployment:`.
- All code, variable names, database identifiers, comments, and technical documentation inside the project MUST be written in English.