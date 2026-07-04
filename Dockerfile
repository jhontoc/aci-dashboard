# ── Base image ───────────────────────────────────────────────
FROM redhat/ubi8:latest

# ── Labels ───────────────────────────────────────────────────
LABEL maintainer="Cisco ACI Dashboard"
LABEL description="ACI Node Comparison Dashboard — Node.js + Python on UBI8"
LABEL version="1.0.0"

# ── System packages ──────────────────────────────────────────
RUN dnf install -y dnf-plugins-core && \
    dnf module install -y nodejs:18 && \
    dnf install -y python39 python39-devel gcc gcc-c++ tar gzip curl make



# ── Verify versions ──────────────────────────────────────────
RUN node --version && npm --version && python3 --version

# ── Working directory ─────────────────────────────────────────
WORKDIR /app

# ── Python dependencies ───────────────────────────────────────

RUN dnf install -y python39 python39-devel gcc
RUN pip3 install --upgrade pip
COPY requirements.txt .
RUN pip3 install -r requirements.txt

# ── Node.js dependencies ──────────────────────────────────────
COPY package.json package-lock.json* ./
RUN npm install --omit=dev


# ── Application source ────────────────────────────────────────
COPY . .

# ── Create runtime directories ────────────────────────────────
RUN mkdir -p /app/data/snapshots /app/data/uploads \
    && chmod 755 /app/data/snapshots /app/data/uploads

# ── Non-root user for security ────────────────────────────────
RUN useradd -r -u 1001 -g root -s /sbin/nologin appuser \
    && chown -R appuser:root /app
USER appuser

# ── Port ─────────────────────────────────────────────────────
EXPOSE 3000

# ── Health check ─────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# ── Entrypoint ───────────────────────────────────────────────
CMD ["node", "server.js"]