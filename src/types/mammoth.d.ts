declare module 'mammoth' {
  interface ConvertInput {
    buffer?: Buffer;
    path?: string;
    arrayBuffer?: ArrayBuffer;
  }

  interface ConvertMessage {
    type: string;
    message: string;
  }

  interface ConvertResult {
    value: string;
    messages: ConvertMessage[];
  }

  export function convertToHtml(
    input: ConvertInput,
    options?: Record<string, unknown>,
  ): Promise<ConvertResult>;

  export function extractRawText(input: ConvertInput): Promise<ConvertResult>;
}
