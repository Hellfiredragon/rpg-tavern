#!/usr/bin/env python3
"""Play back an example adventure stream in the terminal."""

import json
import sys
import os
import textwrap
import tty
import termios
from pathlib import Path

EXAMPLES_DIR = Path(__file__).resolve().parent.parent / "tests" / "resources"

# ── ANSI codes ──────────────────────────────────────────────────────────────

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
ITALIC = "\033[3m"
UNDERLINE = "\033[4m"

FG_WHITE = "\033[97m"
FG_GRAY = "\033[90m"
FG_YELLOW = "\033[33m"
FG_CYAN = "\033[36m"
FG_GREEN = "\033[32m"
FG_MAGENTA = "\033[35m"
FG_RED = "\033[31m"
FG_BLUE = "\033[34m"

BG_DARK = "\033[48;5;235m"
BG_NARRATION = "\033[48;5;236m"

# ── Palette per message type ────────────────────────────────────────────────

STYLE = {
    "scene_marker": {"icon": "◆", "label_color": FG_YELLOW + BOLD, "body_color": FG_YELLOW + DIM},
    "narration":    {"icon": "▍", "label_color": FG_WHITE + DIM,   "body_color": FG_WHITE + ITALIC},
    "intention":    {"icon": "⚑", "label_color": FG_CYAN + BOLD,   "body_color": FG_CYAN},
    "thought":      {"icon": "◌", "label_color": FG_MAGENTA + DIM, "body_color": FG_MAGENTA + ITALIC},
    "dialog":       {"icon": "❝", "label_color": FG_GREEN + BOLD,  "body_color": FG_GREEN},
    "system":       {"icon": "⚙", "label_color": FG_GRAY + DIM,   "body_color": FG_GRAY + DIM},
}

MOOD_COLORS = {
    "weary": FG_BLUE, "guarded": FG_YELLOW, "calculating": FG_RED,
    "measured": FG_CYAN, "amused": FG_GREEN, "businesslike": FG_WHITE,
    "matter-of-fact": FG_WHITE, "quiet": FG_BLUE, "earnest": FG_GREEN,
    "casual": FG_CYAN,
}

# ── Terminal helpers ────────────────────────────────────────────────────────

def term_width() -> int:
    try:
        return os.get_terminal_size().columns
    except OSError:
        return 80


def wait_for_key():
    """Block until the user presses any key. Returns the character."""
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        ch = sys.stdin.read(1)
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
    return ch


def clear_screen():
    sys.stdout.write("\033[2J\033[H")
    sys.stdout.flush()


# ── Rendering ───────────────────────────────────────────────────────────────

def wrap(text: str, indent: int = 6, width: int | None = None) -> str:
    w = (width or term_width()) - indent - 2
    lines = textwrap.wrap(text, width=max(w, 40))
    pad = " " * indent
    return "\n".join(pad + line for line in lines)


def render_divider(label: str = "", char: str = "─") -> str:
    w = term_width() - 2
    if label:
        side = (w - len(label) - 2) // 2
        return f" {FG_GRAY}{char * side} {label} {char * side}{RESET}"
    return f" {FG_GRAY}{char * w}{RESET}"


LABEL_COLORS = {
    "hidden": FG_GRAY + DIM,
    "hunch":  FG_BLUE,
    "urge":   FG_YELLOW,
    "active": FG_RED + BOLD,
    "focus":  FG_MAGENTA + BOLD,
}

CAT_ICONS = {
    "temporary":  "○",
    "persistent": "●",
    "identity":   "◈",
}


def render_extractor(ext: dict, counter: str, turn_seq: str) -> list[str]:
    """Render a structured extractor block."""
    lines: list[str] = []
    char = ext.get("character", "?")
    output = ext.get("output", {})
    state = ext.get("resulting_state", {})

    lines.append("")
    lines.append(f"  {FG_GRAY}{DIM}⚙  {char} Extractor{RESET}  {counter}  {turn_seq}")

    # Output operations
    pad = " " * 6
    amp = output.get("amplify", [])
    sup = output.get("suppress", [])
    ovf = output.get("overflow")
    evo = output.get("evolution")

    if amp:
        lines.append(f"{pad}{FG_GREEN}▲ amplify:{RESET}  {FG_GREEN}{', '.join(amp)}{RESET}")
    if sup:
        lines.append(f"{pad}{FG_RED}▼ suppress:{RESET} {FG_RED}{', '.join(sup)}{RESET}")
    if ovf:
        evo_str = f" → {evo}" if evo else ""
        lines.append(f"{pad}{FG_YELLOW}{BOLD}⬆ overflow:{RESET} {FG_YELLOW}{ovf}{evo_str}{RESET}")

    # Resulting state
    lines.append(f"{pad}{FG_GRAY}{'─' * 40}{RESET}")

    for cat in ("temporary", "persistent", "identity"):
        entries = state.get(cat, {})
        if not entries:
            continue
        icon = CAT_ICONS.get(cat, "·")
        lines.append(f"{pad}{FG_GRAY}{DIM}{icon} {cat}{RESET}")
        for name, info in entries.items():
            label = info.get("label", "?")
            value = info.get("value", 0)
            lc = LABEL_COLORS.get(label, FG_WHITE)
            bar_len = max(1, value // 2)
            bar = "█" * bar_len + "░" * (15 - bar_len)
            lines.append(f"{pad}  {lc}{name:<32}{RESET} {lc}{bar} {label:<7}{RESET} {FG_GRAY}{DIM}({value}){RESET}")

    lines.append("")
    return lines


def render_message(msg: dict, index: int, total: int) -> str:
    mtype = msg["type"]
    owner = msg["owner"]
    content = msg.get("content", "")
    mood = msg.get("mood")
    style = STYLE.get(mtype, STYLE["system"])

    counter = f"{FG_GRAY}{DIM}[{index + 1}/{total}]{RESET}"
    turn_seq = f"{FG_GRAY}{DIM}t{msg['turn_id']}·s{msg['seq']}{RESET}"
    lines: list[str] = []

    if mtype == "scene_marker":
        marker = msg.get("scene_marker", {})
        subtype = marker.get("subtype", "")
        payload = marker.get("payload", {})
        location = payload.get("location", "")
        lines.append("")
        lines.append(render_divider())
        lines.append(f"  {style['label_color']}{style['icon']}  {subtype.upper().replace('_', ' ')}{RESET}  {counter}  {turn_seq}")
        if location:
            lines.append(f"  {style['body_color']}   {location}{RESET}")
        lines.append(render_divider())
        lines.append("")

    elif mtype == "narration":
        lines.append("")
        lines.append(f"  {style['label_color']}{style['icon']}{RESET}  {FG_GRAY}{DIM}Narrator{RESET}  {counter}  {turn_seq}")
        lines.append(f"{style['body_color']}{wrap(content)}{RESET}")
        lines.append("")

    elif mtype == "thought":
        lines.append("")
        lines.append(f"  {style['label_color']}{style['icon']}  {owner}'s thoughts{RESET}  {counter}  {turn_seq}")
        lines.append(f"{style['body_color']}{wrap(content)}{RESET}")
        lines.append("")

    elif mtype == "intention":
        lines.append("")
        lines.append(f"  {style['label_color']}{style['icon']}  {owner}'s intention{RESET}  {counter}  {turn_seq}")
        lines.append(f"{style['body_color']}{wrap(content)}{RESET}")
        lines.append("")

    elif mtype == "dialog":
        mood_color = MOOD_COLORS.get(mood, FG_WHITE) if mood else FG_WHITE
        mood_tag = f"  {mood_color}{DIM}({mood}){RESET}" if mood else ""
        lines.append("")
        lines.append(f"  {style['label_color']}{style['icon']}  {owner}{RESET}{mood_tag}  {counter}  {turn_seq}")
        lines.append(f"{style['body_color']}{wrap(f'"{content}"')}{RESET}")
        lines.append("")

    elif mtype == "system":
        extractor = msg.get("extractor")
        if extractor:
            lines.extend(render_extractor(extractor, counter, turn_seq))
        else:
            lines.append("")
            lines.append(f"  {style['label_color']}{style['icon']}  System{RESET}  {counter}  {turn_seq}")
            lines.append(f"{style['body_color']}{wrap(content)}{RESET}")
            lines.append("")

    return "\n".join(lines)


def render_header(data: dict) -> str:
    lines: list[str] = []
    w = term_width() - 2
    lines.append("")
    lines.append(f" {FG_YELLOW}{BOLD}{'═' * w}{RESET}")
    lines.append(f"  {FG_YELLOW}{BOLD}{data.get('adventure', 'Unknown Adventure').upper().replace('_', ' ')}{RESET}")
    lines.append(f"  {FG_GRAY}Persona: {FG_WHITE}{data.get('player_name', '?')}{RESET}")

    chars = data.get("characters", [])
    if chars:
        parts = []
        for c in chars:
            chattiness = c.get("chattiness", "?")
            tag = "(baked)" if c.get("baked") else f"(chat {chattiness})"
            parts.append(f"{FG_WHITE}{BOLD}{c['name']}{RESET}{FG_GRAY} {tag}")
        names = ", ".join(parts)
        lines.append(f"  {FG_GRAY}Characters: {names}{RESET}")

    total = len(data.get("messages", []))
    lines.append(f"  {FG_GRAY}Messages: {FG_WHITE}{total}{RESET}")
    lines.append(f" {FG_YELLOW}{BOLD}{'═' * w}{RESET}")
    lines.append("")
    lines.append(f"  {DIM}Press any key to advance · q to quit{RESET}")
    lines.append("")
    return "\n".join(lines)


# ── Turn divider ────────────────────────────────────────────────────────────

def render_turn_divider(turn_id: int) -> str:
    return render_divider(f"{FG_YELLOW}{BOLD}Turn {turn_id}{RESET}{FG_GRAY}")


# ── File selection ──────────────────────────────────────────────────────────

def select_example() -> Path | None:
    examples = sorted(EXAMPLES_DIR.glob("*.json"))
    if not examples:
        print(f"  {FG_RED}No example files found in {EXAMPLES_DIR}{RESET}")
        return None
    if len(examples) == 1:
        print(f"  {FG_GREEN}Loading:{RESET} {examples[0].name}")
        return examples[0]

    print(f"\n  {BOLD}Available examples:{RESET}\n")
    for i, f in enumerate(examples, 1):
        print(f"  {FG_CYAN}{BOLD}{i}{RESET}  {f.stem.replace('_', ' ').title()}")
    print()

    while True:
        try:
            raw = input(f"  {FG_GRAY}Choose [1-{len(examples)}]: {RESET}").strip()
            idx = int(raw) - 1
            if 0 <= idx < len(examples):
                return examples[idx]
        except (ValueError, EOFError):
            pass
        print(f"  {FG_RED}Invalid choice.{RESET}")


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    path = select_example()
    if path is None:
        sys.exit(1)

    with open(path) as f:
        data = json.load(f)

    messages = data.get("messages", [])
    if not messages:
        print(f"  {FG_RED}No messages in file.{RESET}")
        sys.exit(1)

    clear_screen()
    print(render_header(data))

    prev_turn: int | None = None

    for i, msg in enumerate(messages):
        turn_id = msg.get("turn_id", 0)

        # Print turn divider on turn change
        if turn_id != prev_turn:
            if prev_turn is not None:
                print(render_turn_divider(turn_id))
            prev_turn = turn_id

        print(render_message(msg, i, len(messages)))

        # Wait for keypress (except after the last message)
        if i < len(messages) - 1:
            ch = wait_for_key()
            if ch in ("q", "Q", "\x03"):  # q or Ctrl-C
                print(f"\n  {DIM}Stopped.{RESET}\n")
                sys.exit(0)

    print(render_divider(f"{FG_YELLOW}{BOLD}End{RESET}{FG_GRAY}"))
    print(f"\n  {DIM}Finished. Press any key to exit.{RESET}")
    wait_for_key()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n  {DIM}Interrupted.{RESET}\n")
