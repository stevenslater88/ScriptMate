# ScriptMate Backend

## Quick Start

### Local Development
```bash
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

### Environment Variables Required
Create a `.env` file with:
```
MONGO_URL=mongodb+srv://username:password@cluster.mongodb.net/scriptmate
DB_NAME=scriptmate
EMERGENT_LLM_KEY=your-openai-compatible-key
```

### API Endpoints
- `GET /api/health` - Health check
- `GET /api/subscription/plans` - Get pricing plans
- `POST /api/users` - Create/get user
- `GET /api/users/{device_id}/limits` - Get user limits
- `POST /api/scripts` - Create script with AI parsing
- `POST /api/rehearsals` - Start rehearsal session

### Deployment Platforms
This backend is ready for deployment on:
- Railway
- Render
- Heroku
- DigitalOcean App Platform
