@echo off
echo Starting Stock Scanner...

echo Starting Backend (FastAPI)...
start "Stock Scanner - Backend" cmd /k "cd /d C:\Users\esten\stock-scanner\backend && .venv\Scripts\python.exe -m uvicorn api.main:app --host 0.0.0.0 --port 8000"

timeout /t 4 /nobreak > nul

echo Starting Frontend (Vite)...
start "Stock Scanner - Frontend" cmd /k "cd /d C:\Users\esten\stock-scanner\frontend && npm run dev"

echo.
echo Both services starting in separate windows.
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:5173
echo.
pause
