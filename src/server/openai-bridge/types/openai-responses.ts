// OpenAI Responses API types (subset used by bridge)

// ==================== Request ====================

export interface ResponsesRequest {
  model: string;
  input: ResponsesInputItem[];
  // #325 — strict proxies (Rust serde — agnes) reject the `instructions`
  // field in every form we tried (bare string AND array of ResponseInput).
  // We therefore DO NOT emit `instructions`; the Anthropic `system` prompt
  // is folded into `input[0]` as a role:'system' message instead. The
  // OpenAI-spec string form is preserved on the type for callers that
  // construct requests against providers known to accept it (e.g. OpenAI
  // direct), but the Responses translator never writes it.
  instructions?: string;
  tools?: ResponsesTool[];
  tool_choice?: ResponsesToolChoice;
  max_output_tokens?: number;
  prompt_cache_key?: string;
  prompt_cache_retention?: '24h' | 'in_memory';
  previous_response_id?: string;
  store?: boolean;
  conversation?: string;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  // #324: effort widened to plain string — same pass-through rationale as
  // OpenAIRequest.reasoning_effort (provider vocabularies diverge).
  reasoning?: { effort: string };
  text?: { format: ResponsesTextFormat };
}

export type ResponsesInputItem =
  | ResponsesInputMessage
  | ResponsesInputFunctionCall
  | ResponsesInputFunctionCallOutput;

export interface ResponsesInputMessage {
  /** #325 — strict proxies (Rust serde untagged enum — agnes, etc.) require
   *  `type:'message'` as a discriminator on every EasyInputMessage; without it
   *  they cannot dispatch this item from sibling variants
   *  (FunctionCallOutput, etc.) and reject the whole input with
   *  `data did not match any variant of untagged enum ResponseInput`. OpenAI's
   *  official schema marks it as Optional but Lenient clients silently omit it,
   *  so we always emit it. */
  type?: 'message';
  role: 'system' | 'user' | 'assistant' | 'developer';
  content: string | ResponsesInputContentPart[];
}

/** Replay of a prior assistant function call in conversation history */
export interface ResponsesInputFunctionCall {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
  status?: string;
}

// OpenAI Responses API input side: only `input_text` / `input_image` are valid.
// `output_text` / `refusal` belong to `ResponsesOutputContent` — including them
// here would let TS approve `{ type: 'output_text' }` inside `EasyInputMessage`,
// which the upstream `untagged enum ResponseInput` rejects with
// "data did not match any variant ... at line 1 column N". Regression caused
// by the previous union shape: see `translateAssistantMessageToResponses`
// and the corresponding unit test for the assistant-text-must-be-input_text
// invariant. If we ever need a refusal block on the input side, that goes
// through `ResponsesInputFunctionCallOutput` instead — not this type.
export type ResponsesInputContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail?: string };

export interface ResponsesInputFunctionCallOutput {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

export interface ResponsesTool {
  type: 'function';
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  // #325 — `strict` is `Required[Optional[bool]]` per OpenAI spec; strict
  // proxies reject the FunctionToolParam variant when this field is absent.
  // Lenient clients accept omission; we always emit `false` (the historical
  // default) for maximum interop with non-strict and strict providers.
  strict?: boolean;
}

export type ResponsesToolChoice =
  | 'auto'
  | 'required'
  | 'none'
  | { type: 'function'; name: string };

export type ResponsesTextFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | { type: 'json_schema'; name: string; schema: Record<string, unknown>; strict?: boolean };

// ==================== Response ====================

export interface ResponsesResponse {
  id: string;
  object: 'response';
  status: 'completed' | 'failed' | 'in_progress' | 'incomplete';
  output: ResponsesOutputItem[];
  usage: ResponsesUsage;
  model: string;
  error?: { code: string; message: string } | null;
}

export type ResponsesOutputItem =
  | ResponsesOutputMessage
  | ResponsesOutputFunctionCall
  | ResponsesOutputReasoning;

export interface ResponsesOutputMessage {
  type: 'message';
  id: string;
  role: 'assistant';
  status: string;
  content: ResponsesOutputContent[];
}

export type ResponsesOutputContent =
  | { type: 'output_text'; text: string }
  | { type: 'refusal'; refusal: string };

export interface ResponsesOutputFunctionCall {
  type: 'function_call';
  id: string;
  call_id: string;
  name: string;
  arguments: string;
  status: string;
}

export interface ResponsesOutputReasoning {
  type: 'reasoning';
  id: string;
  summary: { type: 'summary_text'; text: string }[];
}

export interface ResponsesUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: {
    cached_tokens?: number;
  };
  output_tokens_details?: {
    reasoning_tokens?: number;
  };
}

// ==================== Streaming Events ====================

export type ResponsesStreamEvent =
  | { type: 'response.created'; response: ResponsesResponse }
  | { type: 'response.in_progress'; response: ResponsesResponse }
  | { type: 'response.completed'; response: ResponsesResponse }
  | { type: 'response.failed'; response: ResponsesResponse }
  | { type: 'response.output_item.added'; output_index: number; item: ResponsesOutputItem }
  | { type: 'response.output_item.done'; output_index: number; item: ResponsesOutputItem }
  | { type: 'response.content_part.added'; output_index: number; content_index: number; part: ResponsesOutputContent }
  | { type: 'response.content_part.done'; output_index: number; content_index: number; part: ResponsesOutputContent }
  | { type: 'response.output_text.delta'; output_index: number; content_index: number; delta: string }
  | { type: 'response.output_text.done'; output_index: number; content_index: number; text: string }
  | { type: 'response.function_call_arguments.delta'; output_index: number; delta: string }
  | { type: 'response.function_call_arguments.done'; output_index: number; arguments: string }
  | { type: 'response.reasoning_summary_text.delta'; output_index: number; delta: string }
  | { type: 'response.reasoning_summary_text.done'; output_index: number; text: string };
