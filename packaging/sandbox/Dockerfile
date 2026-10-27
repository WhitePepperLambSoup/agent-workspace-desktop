ARG BASE_IMAGE
FROM ${BASE_IMAGE}

LABEL org.opencontainers.image.title="Agent Workspace Sandbox"
LABEL org.opencontainers.image.description="Offline wrapper for a digest-pinned coding toolchain"
LABEL org.opencontainers.image.vendor="Agent Workspace"

ENV CI=1 \
    HOME=/tmp \
    NO_COLOR=1 \
    PAGER=cat \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONIOENCODING=utf-8 \
    PYTHONNOUSERSITE=1 \
    PYTHONUTF8=1

WORKDIR /workspace
USER 65532:65532
CMD ["/bin/sh"]
