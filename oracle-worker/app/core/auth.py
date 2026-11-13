import jwt
from jwt import PyJWKClient
from fastapi import Header, HTTPException
from app.core.config import settings

_jwks_client = None

def _jwks():
    global _jwks_client
    if _jwks_client is None and settings.SUPABASE_JWKS_URL:
        # Cached and short: this runs synchronously inside the auth middleware, so a
        # 30 s fetch every five minutes would stall every request on the box.
        _jwks_client = PyJWKClient(settings.SUPABASE_JWKS_URL, cache_keys=True, lifespan=3600, timeout=5)
    return _jwks_client

def get_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing token")
    token = authorization.split(" ", 1)[1]
    try:
        # The header is unverified, so it only picks WHICH check runs — each
        # branch still pins its own algorithms. HS256 against an EMPTY secret is
        # no check at all (anyone can sign with ""), so it is refused outright
        # until SUPABASE_JWT_SECRET is set. exp + sub are required, not merely
        # checked when present: a token with no expiry is valid forever.
        alg = jwt.get_unverified_header(token).get("alg", "")
        opts = {"require": ["exp", "sub"]}
        # A minute of grace on exp: a phone whose clock runs behind still sends a
        # token it believes is fresh, and a paying reader must not meet a 402 for it.
        skew = 60
        if alg == "HS256":
            if not settings.SUPABASE_JWT_SECRET:
                raise Exception("HS256 token but no SUPABASE_JWT_SECRET")
            payload = jwt.decode(
                token, settings.SUPABASE_JWT_SECRET,
                algorithms=["HS256"], audience="authenticated", options=opts, leeway=skew,
            )
        else:
            client = _jwks()
            if client is None:
                raise Exception("no jwks url")
            key = client.get_signing_key_from_jwt(token).key
            payload = jwt.decode(
                token, key,
                algorithms=["ES256", "RS256"], audience="authenticated", options=opts, leeway=skew,
            )
    except Exception:
        raise HTTPException(status_code=401, detail="invalid token")
    uid = payload.get("sub")
    if not uid:
        raise HTTPException(status_code=401, detail="no sub")
    return {"id": uid, "email": payload.get("email")}


def get_user_optional(authorization):
    """Soft variant: verify the token if present, else return None (never raises).
    Lets an endpoint apply per-user limits when a valid token is sent and fall back
    to per-IP behaviour otherwise — so it can't break clients that don't send one."""
    if not authorization or not str(authorization).startswith("Bearer "):
        return None
    try:
        return get_user(authorization)
    except Exception:
        return None
