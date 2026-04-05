import os
import anthropic
from datetime import datetime, timezone


MODEL = "claude-sonnet-4-6"


def get_client() -> anthropic.Anthropic:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")
    return anthropic.Anthropic(api_key=api_key)


def execute_task(agent_name: str, agent_description: str, task_title: str, task_description: str) -> dict:
    """
    エージェント情報とタスク内容をLLMに渡してタスクを実行する。
    戻り値: {"output": str, "usage": {"input_tokens": int, "output_tokens": int}}
    """
    client = get_client()

    system_prompt = (
        f"あなたは「{agent_name}」というAIエージェントです。\n"
        f"役割: {agent_description}\n\n"
        "与えられたタスクを丁寧に処理し、結果を日本語で返してください。"
    )

    user_message = f"## タスク: {task_title}\n\n{task_description}"

    message = client.messages.create(
        model=MODEL,
        max_tokens=2048,
        system=system_prompt,
        messages=[
            {"role": "user", "content": user_message}
        ]
    )

    output = message.content[0].text if message.content else ""
    usage = {
        "input_tokens": message.usage.input_tokens,
        "output_tokens": message.usage.output_tokens,
    }
    return {"output": output, "usage": usage}
