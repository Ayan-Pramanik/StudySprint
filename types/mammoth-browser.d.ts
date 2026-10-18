declare module 'mammoth/mammoth.browser.js' {
    type ExtractRawTextInput = { arrayBuffer: ArrayBuffer };
    type ExtractRawTextOutput = {
        value: string;
        messages: { type: string; message: string }[];
    };

    const mammoth: {
        extractRawText(input: ExtractRawTextInput): Promise<ExtractRawTextOutput>;
    };

    export default mammoth;
}
