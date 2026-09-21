"""The MCP server Hermes talks to: it advertises and runs the same tools."""

import asyncio
import json

import mcp.types as types

import mcp_server
from tools.budget_tools import TOOL_SCHEMAS


def test_every_tool_is_advertised():
    result = asyncio.run(mcp_server.on_list_tools(None, None))
    assert [tool.name for tool in result.tools] == [schema["name"] for schema in TOOL_SCHEMAS]
    assert all(tool.input_schema["type"] == "object" for tool in result.tools)


def test_a_tool_call_returns_its_json(catalog):
    params = types.CallToolRequestParams(name="list_materials", arguments={"search": "arena"})
    result = asyncio.run(mcp_server.on_call_tool(None, params))
    payload = json.loads(result.content[0].text)
    assert payload["materials"][0]["name"] == "Arena fina"


def test_a_failing_call_comes_back_as_an_error(catalog):
    params = types.CallToolRequestParams(name="get_material", arguments={})
    payload = json.loads(asyncio.run(mcp_server.on_call_tool(None, params)).content[0].text)
    assert "error" in payload
