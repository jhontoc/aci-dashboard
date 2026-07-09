ARG container_image


# ── Base image ───────────────────────────────────────────────
FROM ${container_image}


# ── Labels ───────────────────────────────────────────────────
LABEL maintainer="Cisco ACI Dashboard"
LABEL description="ACI Node Comparison Dashboard"
LABEL version="1.0.0"

# ── System packages ──────────────────────────────────────────
RUN yum install -y git python3.11-pip sshpass
RUN yum install -y python3.11-devel
RUN yum install -y krb5-devel
RUN yum install -y procps-ng
RUN yum install -y nc
RUN yum install -y nano
RUN yum install -y tar
RUN yum install -y gcc libffi-devel openssl-devel python3.11 bzip2-devel openssh-clients openssh-server passwd libssh
RUN yum install -y nodejs
RUN yum install -y gcc-c++ gzip curl make

ARG index
RUN python3 -m pip install --upgrade pip setuptools ${index}
RUN python3 -m pip install "paramiko<4.0.0" ${index}
RUN python3 -m pip install pysocks ${index}
RUN python3 -m pip install nodejs ${index}
RUN python3 -m pip install certifi ${index}
RUN python3 -m pip install PyYAML ${index}
RUN python3 -m pip install requests ${index}



# ── Verify versions ──────────────────────────────────────────
RUN node --version && npm --version && python3 --version

# ── Working directory ─────────────────────────────────────────
WORKDIR /app



# ── Copy and install Node.js dependencies ──
COPY . .
RUN tar -xzvf offline-packages/app-deps.tar.gz 
RUN tar -xzvf offline-packages/my-app-bundle.tar.gz 
RUN tar -xzvf offline-packages/node_modules.tar.gz



# ── Create runtime directories ────────────────────────────────
RUN mkdir -p /app/data/snapshots /app/data/uploads \
    && chmod 755 /app/data/snapshots /app/data/uploads

# ── Non-root user for security ────────────────────────────────
RUN useradd -r -u 1001 -g root -d /home/appuser appuser && \
    echo "appuser:cisco" | chpasswd && \
    echo "root:cisco" | chpasswd && \
    mkdir -p /home/appuser && \
    mkdir -p /var/run/sshd && \
    chown -R appuser:root /home/appuser /app  && \
    chown -R appuser:root /etc/ssh/

USER appuser

# ── Port ─────────────────────────────────────────────────────
EXPOSE 3001

# ── Health check ─────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# ── Entrypoint ───────────────────────────────────────────────
CMD ["node", "server.js"]