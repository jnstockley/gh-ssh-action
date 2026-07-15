FROM python:3.12-slim@sha256:c3d81d25b3154142b0b42eb1e61300024426268edeb5b5a26dd7ddf64d9daf28

RUN pip install --no-cache-dir uv==0.11.28

WORKDIR /action

# Install dependencies first for better layer caching.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

# Copy source and install the project itself.
COPY src ./src
RUN uv sync --frozen --no-dev

# Run as a non-root user (defense in depth; the process never needs root privileges).
RUN useradd --create-home --shell /usr/sbin/nologin action && \
    chown -R action:action /action
USER action

ENTRYPOINT ["uv", "run", "--no-sync", "python", "-m", "gh_ssh_action.main"]

