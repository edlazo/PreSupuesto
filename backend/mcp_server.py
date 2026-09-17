"""MCP server exposing the PreSupuesto budgeting tools to Hermes Agent.

Hermes discovers external tools through MCP, so this process is what lets the
agent read materials, price estimates, manage clients and create budgets. It
speaks MCP over stdio: Hermes spawns it, so nothing listens on a port.

Register it in `~/.hermes/config.yaml` (see `hermes.config.example.yaml`):

    mcp_servers:
      presupuesto:
        command: "<absolute path to the backend venv python>"
        args: ["<absolute path>/backend/mcp_server.py"]

Run it by hand to check that it starts:

    python mcp_server.py

It then sits silently waiting for MCP traffic on stdin — that is correct.
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

# Hermes spawns this file from an arbitrary working directory, so make the
# backend modules importable regardless of where the process was started.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import anyio  # noqa: E402
import mcp.types as types  # noqa: E402
from mcp.server.lowlevel import Server  # noqa: E402
from mcp.server.lowlevel.server import ServerRequestContext  # noqa: E402
from mcp.server.stdio import stdio_server  # noqa: E402

from tools.budget_tools import TOOL_SCHEMAS, dispatch_tool  # noqa: E402

# Logs go to stderr: stdout carries the MCP protocol and must stay clean.
logging.basicConfig(level=logging.INFO, stream=sys.stderr)
logger = logging.getLogger("presupuesto.mcp")

SERVER_NAME = "presupuesto"


async def on_list_tools(
    ctx: ServerRequestContext[object],
    params: types.PaginatedRequestParams | None,
) -> types.ListToolsResult:
    """Advertise the budgeting tools to Hermes."""
    return types.ListToolsResult(
        tools=[
            types.Tool(
                name=schema["name"],
                description=schema["description"],
                inputSchema=schema["parameters"],
            )
            for schema in TOOL_SCHEMAS
        ]
    )


async def on_call_tool(
    ctx: ServerRequestContext[object],
    params: types.CallToolRequestParams,
) -> types.CallToolResult:
    """Run a tool and return its JSON string result.

    The handlers reach Supabase through a synchronous client, so they run in a
    worker thread to keep the MCP event loop free. A tool never raises: errors
    come back as `{"error": "..."}` for the agent to read and react to.
    """
    name = params.name
    arguments = dict(params.arguments or {})
    logger.info("Tool call: %s", name)

    result = await anyio.to_thread.run_sync(lambda: dispatch_tool(name, arguments))
    return types.CallToolResult(content=[types.TextContent(type="text", text=result)])


server: Server[object] = Server(
    SERVER_NAME,
    version="0.1.0",
    instructions=(
        "Tools to build construction and renovation budgets for PreSupuesto: "
        "read the materials and standard tasks catalogs, price estimates, "
        "manage clients, and store budgets."
    ),
    on_list_tools=on_list_tools,
    on_call_tool=on_call_tool,
)


async def main() -> None:
    """Serve MCP over stdio until the client disconnects."""
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
