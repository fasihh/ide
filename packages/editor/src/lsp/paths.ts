import { monaco } from "../monaco.ts";

/** `file://` URI string of an absolute path, as used for editor model paths backed by real files. */
export const fileModelPath = (absolutePath: string) => monaco.Uri.file(absolutePath).toString();
