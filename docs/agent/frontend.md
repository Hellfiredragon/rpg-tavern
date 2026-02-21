# Frontend Rules

> Load when: working on React components, Vite config, routing, or frontend state.

---

## Stack

- **Vite** is the build tool. Do not introduce Next.js, CRA, or any other meta-framework without updating `AGENT.md`.
- Components are functional and typed with **TypeScript**. No class components.
- Check what pages and components already exist before creating new ones:
  ```bash
  bash scripts/agent/list_frontend.sh
  ```

---

## State Management

Escalate only when necessary:

1. **Local `useState`** — default for component-scoped state.
2. **React Context** — for state shared across a subtree.
3. **External store** — only if context causes measurable performance problems or the state is genuinely global. Document the decision in a comment.

Do not reach for a state library speculatively.

---

## Components

- One component per file. File name matches the component name.
- Props interfaces are defined in the same file as the component, named `<ComponentName>Props`.
- No business logic in components. Data fetching and transformation belong in hooks or service modules.
- Do not inline complex conditional rendering — extract to a named variable or sub-component.

---

## Styling

Check the existing approach before adding anything:
```bash
bash scripts/agent/list_frontend.sh
```
Do not introduce a new CSS strategy or UI library without updating `AGENT.md`.

---

## Frontend's Role in the Engine

The frontend is a **consumer and display layer** — it renders narration, character state, and world context. It contains no game logic. Game logic lives in the backend pipeline. If you find yourself implementing game rules in the frontend, stop and reconsider the architecture.
