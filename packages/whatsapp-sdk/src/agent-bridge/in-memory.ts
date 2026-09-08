import type { AgentInbox, AgentTask } from "./types.js";

/**
 * In-memory implementation of {@link AgentInbox}. Records every
 * appended task in arrival order; exposes the recorded sequence
 * for assertions.
 *
 * Appropriate for development, testing, and single-process
 * deployments where the agent runs in the same process as the
 * webhook receiver. Multi-process / multi-node deployments
 * implement their own inbox against the relevant queue backend
 * (Redis Streams, BullMQ, Postgres LISTEN/NOTIFY, SQS).
 *
 * @example
 * ```ts
 * const inbox = new InMemoryAgentInbox();
 * const bridge = createAgentBridge({ receiver, client, inbox });
 * // … events fire …
 * console.log(inbox.tasks); // ReadonlyArray<AgentTask>
 * ```
 */
export class InMemoryAgentInbox implements AgentInbox {
  #tasks: AgentTask[] = [];

  /** Tasks the inbox has accepted, in arrival order. */
  public get tasks(): ReadonlyArray<AgentTask> {
    return this.#tasks;
  }

  public append(task: AgentTask): Promise<void> {
    this.#tasks.push(task);
    return Promise.resolve();
  }

  /** Clear the recorded tasks. Useful between test cases. */
  public reset(): void {
    this.#tasks = [];
  }
}
