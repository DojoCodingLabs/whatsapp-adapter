// Approved-template definitions returned by Meta's
// `/{waba-id}/message_templates` endpoint. Best-effort modelling — the
// shape evolves and unrecognised component types pass through harmlessly.

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION" | (string & {});

export type TemplateStatus =
  | "APPROVED"
  | "PENDING"
  | "REJECTED"
  | "PAUSED"
  | "DISABLED"
  | "FLAGGED"
  | (string & {});

export type TemplateComponentDefinitionType =
  | "HEADER"
  | "BODY"
  | "FOOTER"
  | "BUTTONS"
  | (string & {});

export interface TemplateButtonDefinition {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE" | "OTP" | (string & {});
  text?: string;
  url?: string;
  phone_number?: string;
  example?: ReadonlyArray<string>;
}

/**
 * Header formats that take exactly ONE media / location parameter at
 * send time instead of `{{N}}` text placeholders.
 */
export type TemplateMediaHeaderFormat = "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION";

/**
 * How a template's placeholders are addressed. `POSITIONAL` is
 * `{{1}}`, `{{2}}`, …; `NAMED` is `{{customer_name}}` with
 * `parameter_name` on every send-time parameter. Meta omits the
 * field on older positional templates.
 */
export type TemplateParameterFormat = "POSITIONAL" | "NAMED" | (string & {});

export interface TemplateComponentDefinition {
  type: TemplateComponentDefinitionType;
  /** Header format ("TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION"). */
  format?: "TEXT" | TemplateMediaHeaderFormat | (string & {});
  /** The body / header text containing `{{1}}`, `{{2}}`, … (or `{{name}}`) placeholders. */
  text?: string;
  /** Example values Meta shows in the editor. */
  example?: {
    body_text?: ReadonlyArray<ReadonlyArray<string>>;
    body_text_named_params?: ReadonlyArray<{ param_name: string; example: string }>;
    header_text?: ReadonlyArray<string>;
    header_text_named_params?: ReadonlyArray<{ param_name: string; example: string }>;
    header_handle?: ReadonlyArray<string>;
  };
  /** Buttons component lists buttons here (capitalised in the API). */
  buttons?: ReadonlyArray<TemplateButtonDefinition>;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  language: string;
  category: TemplateCategory;
  status: TemplateStatus;
  components: ReadonlyArray<TemplateComponentDefinition>;
  /**
   * `"NAMED"` when the template uses `{{name}}` placeholders. When
   * absent the SDK infers the format from the placeholder text.
   */
  parameter_format?: TemplateParameterFormat;
  quality_score?: { score: string; date?: number };
}

export interface ListTemplatesQuery {
  name?: string;
  language?: string;
  status?: TemplateStatus;
  category?: TemplateCategory;
  limit?: number;
  /** Cursor pagination forward. */
  after?: string;
  /** Cursor pagination backward. */
  before?: string;
}

export interface ListTemplatesPaging {
  cursors?: { after?: string; before?: string };
  next?: string;
  previous?: string;
}

export interface ListTemplatesResponse {
  data: ReadonlyArray<TemplateDefinition>;
  paging?: ListTemplatesPaging;
}
