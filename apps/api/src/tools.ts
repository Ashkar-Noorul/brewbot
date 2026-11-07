import { z } from "zod";
import { pool } from "./db.ts";

/**
 * A tool the model can call, defined once and adapted to each provider's format in llm.ts.
 * `input` validates the model's arguments before `run` sees them: models can produce
 * malformed or truncated arguments, and tool code should never trust them blindly.
 */
export interface Tool<T extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: T;
  run: (input: z.infer<T>) => Promise<Record<string, unknown>>;
}

/** Keeps each tool's `run` typed by its own schema while letting all tools share one list. */
function defineTool<T extends z.ZodType>(tool: Tool<T>): Tool {
  return tool as unknown as Tool;
}

const getOrderStatus = defineTool({
  name: "get_order_status",
  description:
    "Look up the status of a customer's order. Requires BOTH the order number and the email address used " +
    "for the order; ask the customer for whichever is missing before calling. Never guess either value.",
  input: z.object({
    order_number: z.string().describe('Order number, "BB-" followed by six digits, e.g. BB-104233'),
    email: z.string().describe("Email address the order was placed with"),
  }),
  async run({ order_number, email }) {
    const orderNumber = order_number.trim().toUpperCase();
    if (!/^BB-\d{6}$/.test(orderNumber)) {
      return { found: false, message: 'Order numbers look like "BB-" followed by six digits, e.g. BB-104233.' };
    }
    const { rows } = await pool.query(
      // Dates as text: as JS Dates they'd shift a day in timezones ahead of UTC once serialised.
      `SELECT order_number, status, items, placed_at::text, carrier, tracking_url, estimated_delivery::text
         FROM orders WHERE order_number = $1 AND lower(email) = lower($2)`,
      [orderNumber, email.trim()],
    );
    // Same reply whether the number or the email was wrong, so the tool can't be used
    // to discover which order numbers exist.
    if (rows.length === 0) {
      return { found: false, message: "No order matches that order number and email address." };
    }
    return { found: true, order: rows[0] };
  },
});

export const ESCALATE_TOOL = "escalate_to_human";

const escalateToHuman = defineTool({
  name: ESCALATE_TOOL,
  description:
    "Offer the customer a contact form so a member of the support team can follow up by email. Use when the " +
    "customer asks for a person, is unhappy or wants to complain, needs something only staff can do (refunds, " +
    "changing an order, warranty claims), or when the sources don't answer their question.",
  input: z.object({
    reason: z.enum(["customer_request", "complaint", "needs_staff_action", "unanswered_question"]),
    summary: z.string().describe("One sentence summarising what the customer needs, for the support team"),
  }),
  async run() {
    return {
      ok: true,
      note:
        "A contact form is now showing in the chat window. Briefly tell the customer they can leave their " +
        "name and email there and the team will reply within one working day.",
    };
  },
});

export const tools: Tool[] = [getOrderStatus, escalateToHuman];

/** Validates the model's arguments and runs the tool. Errors come back as data for the model to handle. */
export async function runTool(name: string, args: unknown): Promise<{ result: Record<string, unknown>; isError: boolean }> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { result: { error: `Unknown tool "${name}"` }, isError: true };

  const parsed = tool.input.safeParse(args);
  if (!parsed.success) {
    return { result: { error: "Invalid arguments", issues: z.treeifyError(parsed.error) }, isError: true };
  }
  try {
    return { result: await tool.run(parsed.data), isError: false };
  } catch (error) {
    console.error(`tool ${name} failed`, error);
    return { result: { error: "The lookup failed. Apologise and offer to connect the customer with the team." }, isError: true };
  }
}
