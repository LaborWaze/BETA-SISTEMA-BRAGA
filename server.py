# server.py
import os
import io
import json
import uuid
from pathlib import Path
from urllib.parse import urlparse

import pandas as pd
import chardet

from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from sqlalchemy import create_engine, text

# ===== Config (DATABASE_URL) =====
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://postgres:postgres@localhost:5432/cnes_dados"
)

# Corrige prefixo antigo
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)

# sslmode=require só para URL EXTERNA (no Render, a interna não precisa)
host = (urlparse(DATABASE_URL).hostname or "").lower()
is_internal = host.endswith(".internal") or "-internal" in host
if "sslmode=" not in DATABASE_URL and not is_internal:
    sep = "&" if "?" in DATABASE_URL else "?"
    DATABASE_URL = f"{DATABASE_URL}{sep}sslmode=require"

engine = create_engine(DATABASE_URL)

# ===== Colunas “pertinentes” =====
PERTINENTES = [
    "municipio",
    "cnes",
    "nome_fantasia",
    "profissional_nome",
    "profissional_cns",
    "profissional_atende_sus",
    "profissional_cbo",
    "carga_horaria_ambulatorial_sus",
    "carga_horaria_outros",
    "profissional_vinculo",
    "equipe_ine",
    "tipo_equipe",
    "equipe_subtipo",
    "equipe_nome",
    "equipe_area",
    "equipe_dt_ativacao",
    "equipe_dt_desativacao",
    "equipe_dt_entrada",
    "equipe_dt_desligamento",
    "natureza_juridica",
]

# ===== FastAPI =====
app = FastAPI(title="Relatórios API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

# ===== Utils =====
class RowsIn(BaseModel):
    rows: list[dict]
    
class PatchIn(BaseModel):
    id: str
    changes: dict
    

ALIASES = {
    "nome_fantaia": "nome_fantasia",   # typo comum
    "tipo equipe": "tipo_equipe",      # cabeçalho com espaço
}

def _normalize_cols(df: pd.DataFrame) -> pd.DataFrame:
    """minúsculas + underscore + corrige typos/aliases"""
    df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
    df = df.rename(columns={k: v for k, v in ALIASES.items() if k in df.columns})
    return df

def _ensure_row_ids(df: pd.DataFrame) -> pd.DataFrame:
    """
    Garante a existencia da coluna tecnica __id (uuid em texto).
    """
    if "__id" not in df.columns:
        df["__id"] = [str(uuid.uuid4()) for _ in range(len(df))]
    return df

def _read_csv_smart(file_bytes: bytes) -> pd.DataFrame:
    """detecta encoding e tenta ; e , como separadores"""
    try:
        enc = chardet.detect(file_bytes).get("encoding") or "utf-8"
    except Exception:
        enc = "utf-8"

    for sep in [";", ","]:
        try:
            df = pd.read_csv(
                io.BytesIO(file_bytes),
                sep=sep,
                encoding=enc,
                low_memory=False,
                dtype=str
            )
            if df.shape[1] > 1:
                return df
        except Exception:
            pass

    # fallback do pandas
    return pd.read_csv(io.BytesIO(file_bytes), encoding=enc, low_memory=False, dtype=str)

def _touch_version():
    """Atualiza/insere um 'version' para clientes detectarem mudanças."""
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS relatorios_meta (id int primary key, version bigint)
        """))
        conn.execute(text("""
            INSERT INTO relatorios_meta (id, version)
            VALUES (1, EXTRACT(EPOCH FROM NOW())::bigint)
            ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version
        """))

def _get_version() -> int:
    with engine.begin() as conn:
        v = conn.execute(
            text("SELECT COALESCE(version,0) FROM relatorios_meta WHERE id=1")
        ).scalar()
    return int(v or 0)

# ===== Rotas =====

@app.post("/api/upload-csv")
async def upload_csv(
    file: UploadFile = File(...),
    columns: str | None = None,
    only_pertinentes: bool = True,
):
    """
    Pré-visualização:
    - aceita CSV (auto encoding e separador)
    - normaliza colunas
    - filtra pertinentes (opcional)
    - devolve até 100 linhas + total
    """
    try:
        raw = await file.read()
        df = _read_csv_smart(raw)
        df = _normalize_cols(df)

        # define colunas
        if columns:
            cols_req = json.loads(columns)
            cols = [c for c in cols_req if c in df.columns]
        else:
            cols = [c for c in (PERTINENTES if only_pertinentes else list(df.columns)) if c in df.columns]

        if not cols:
            raise HTTPException(400, "Nenhuma coluna reconhecida no CSV.")

        df = df[cols]

        # limpeza de caracteres nulos
        for c in df.select_dtypes(include="object").columns:
            df[c] = df[c].astype(str).str.replace("\x00", "", regex=False)

        total = len(df)
        preview = df.head(100).to_dict(orient="records")
        return {"columns": cols, "rows": preview, "total": int(total)}
    except Exception as e:
        raise HTTPException(400, f"Erro ao processar CSV: {e}")

@app.post("/api/reports/save")
async def save_rows(payload: RowsIn):
    """
    Salva as linhas (JSON) na tabela dados_filtrados (replace) e
    atualiza a 'version' para clientes espelharem mudanças.
    """
    try:
        df = pd.DataFrame(payload.rows)
        if df.empty:
            raise HTTPException(400, "Sem linhas para salvar.")
        df = _normalize_cols(df)
        cols = [c for c in PERTINENTES if c in df.columns]
        df = df[cols]
        df = _ensure_row_ids(df)
        df.to_sql("dados_filtrados", engine, if_exists="replace", index=False)
        _touch_version()
        return {"message": f"Salvo {len(df)} linha(s) em dados_filtrados."}
    except Exception as e:
        raise HTTPException(500, f"Erro ao salvar: {e}")

@app.get("/api/reports/data")
async def get_data(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
):
    """
    Dados salvos com paginação e versão (para espelho Admin↔Gestor).
    """
    try:
        with engine.begin() as conn:
            total = conn.execute(text("SELECT COUNT(*) FROM dados_filtrados")).scalar() or 0
            if total == 0:
                return {"columns": [], "rows": [], "page": page, "page_size": page_size, "total": 0, "version": _get_version()}

            offset = (page - 1) * page_size
            order_sql = "ORDER BY __id"
            rows = conn.execute(text(f"""
                SELECT * FROM dados_filtrados
                {order_sql}
                OFFSET :off LIMIT :lim
            """), {"off": offset, "lim": page_size}).mappings().all()

        columns = list(rows[0].keys()) if rows else []
        return {
            "columns": columns,
            "rows": [dict(r) for r in rows],
            "page": page,
            "page_size": page_size,
            "total": int(total),
            "version": _get_version(),
        }
    except Exception:
        # tabela ainda inexistente
        return {"columns": [], "rows": [], "page": page, "page_size": page_size, "total": 0, "version": _get_version()}

@app.patch("/api/reports/row")
async def patch_row(payload: PatchIn):
    try:
      if not payload.id:
          raise HTTPException(400, "ID ausente.")
      changes = {str(k).strip().lower(): v for k,v in (payload.changes or {}).items()}
      allowed = [c for c in changes if c in PERTINENTES]
      if not allowed:
          raise HTTPException(400, "Nada para atualizar.")
      sets = ", ".join(f"{c} = :{c}" for c in allowed)
      params = {c: changes[c] for c in allowed}
      params["id"] = payload.id
      with engine.begin() as conn:
          res = conn.execute(text(f"UPDATE dados_filtrados SET {sets} WHERE __id = :id"), params)
          if res.rowcount == 0:
              raise HTTPException(404, "Linha não encontrada.")
      _touch_version()        
      return {"ok": True}
    except HTTPException:
      raise
    except Exception as e:
      raise HTTPException(500, f"Erro ao atualizar: {e}")

@app.put("/api/reports/data")
async def replace_data(payload: RowsIn):
    """
    Substitui completamente a tabela dados_filtrados e atualiza version.
    """
    try:
        df = pd.DataFrame(payload.rows)
        if df.empty:
            raise HTTPException(400, "Sem linhas para salvar.")
        df = _normalize_cols(df)
        cols = [c for c in PERTINENTES if c in df.columns]
        df = df[cols]
        df = _ensure_row_ids(df)
        df.to_sql("dados_filtrados", engine, if_exists="replace", index=False)
        _touch_version()
        return {"message": f"Atualizado com {len(df)} linha(s)."}
    except Exception as e:
        raise HTTPException(500, f"Erro ao atualizar: {e}")

# ===== Static (FRONTEND) =====
# html=True entrega index.html em "/"
app.mount("/", StaticFiles(directory=".", html=True), name="static")
