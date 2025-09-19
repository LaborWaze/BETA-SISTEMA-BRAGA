# server.py
import os
from fastapi.staticfiles import StaticFiles
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
from sqlalchemy import create_engine
import io, json

# ===== Config (DATABASE_URL) =====
# Em produção (Render), use a variável DATABASE_URL.
# Em desenvolvimento local, se quiser, ela cai no fallback para localhost.
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://postgres:postgres@localhost:5432/cnes_dados"
)

# Corrige prefixo antigo e garante SSL no Render
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)

if "sslmode=" not in DATABASE_URL:
    sep = "&" if "?" in DATABASE_URL else "?"
    DATABASE_URL = f"{DATABASE_URL}{sep}sslmode=require"

engine = create_engine(DATABASE_URL)


PERTINENTES = [
    "municipio",
    "cnes",
    "nome_fantaia",
    "profissional_nome",
    "profissional_cns",
    "profissional_atende_sus",
    "profissional_cbo",
    "carga_horaria_ambulatorial_sus",
    "carga_horaria_outros",
    "profissional_vinculo",
    "equipe_ine",
    "TIPO EQUIPE",
    "equipe_subtipo",
    "equipe_nome",
    "equipe_area",
    "equipe_dt_ativacao",
    "equipe_dt_desativacao",
    "equipe_dt_entrada",
    "equipe_dt_desligamento",
    "natureza_juridica"
]

app = FastAPI(title="Relatórios API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

class RowsIn(BaseModel):
    rows: list[dict]

def _normalize_cols(df: pd.DataFrame) -> pd.DataFrame:
    df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
    if "nome_fantaia" in df.columns:  # alguns CSVs vêm com typo
        df = df.rename(columns={"nome_fantaia":"nome_fantasia"})
    return df

@app.post("/api/upload-csv")
async def upload_csv(file: UploadFile = File(...), columns: str | None = None):
    try:
        raw = await file.read()
        df = pd.read_csv(io.BytesIO(raw), encoding="latin1")
        df = _normalize_cols(df)
        cols = json.loads(columns) if columns else PERTINENTES
        cols = [c for c in cols if c in df.columns]
        if not cols:
            raise HTTPException(400, "Nenhuma coluna encontrada no CSV.")
        df = df[cols]
        # pequena limpeza
        for c in df.select_dtypes(include="object").columns:
            df[c] = df[c].astype(str).str.replace("\x00", "", regex=False)
        preview = df.head(500).to_dict(orient="records")
        return {"columns": cols, "rows": preview}
    except Exception as e:
        raise HTTPException(400, f"Erro ao processar CSV: {e}")

@app.post("/api/reports/save")
async def save_rows(payload: RowsIn):
    try:
        df = pd.DataFrame(payload.rows)
        if df.empty:
            raise HTTPException(400, "Sem linhas para salvar.")
        df = _normalize_cols(df)
        # garante apenas colunas “pertinentes”
        cols = [c for c in PERTINENTES if c in df.columns]
        df = df[cols]
        # salva (substitui) em tabela dedicada
        df.to_sql("dados_filtrados", engine, if_exists="replace", index=False)
        return {"message": f"Salvo {len(df)} linha(s) em dados_filtrados."}
    except Exception as e:
        raise HTTPException(500, f"Erro ao salvar: {e}")

@app.get("/api/reports/data")
async def get_data():
    try:
        df = pd.read_sql("SELECT * FROM dados_filtrados", engine)
        rows = df.to_dict(orient="records")
        return {"rows": rows}
    except Exception as e:
        # tabela pode não existir ainda
        return {"rows": []}

@app.put("/api/reports/data")
async def replace_data(payload: RowsIn):
    try:
        df = pd.DataFrame(payload.rows)
        if df.empty:
            raise HTTPException(400, "Sem linhas para salvar.")
        df = _normalize_cols(df)
        cols = [c for c in PERTINENTES if c in df.columns]
        df = df[cols]
        df.to_sql("dados_filtrados", engine, if_exists="replace", index=False)
        return {"message": f"Atualizado com {len(df)} linha(s)."}
    except Exception as e:
        raise HTTPException(500, f"Erro ao atualizar: {e}")
    
    # Servir os arquivos estáticos desta mesma pasta (FRONTEND)
# html=True faz com que "/" entregue o index.html automaticamente
app.mount("/", StaticFiles(directory=".", html=True), name="static")

