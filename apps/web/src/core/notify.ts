import { toast } from "sonner";
import type { NotifyApi } from "@cp-ide/plugin-api/web";

export const notify: NotifyApi = {
  info: (message, description) => toast(message, { description }),
  success: (message, description) => toast.success(message, { description }),
  error: (message, description) => toast.error(message, { description }),
};

export function reportError(context: string) {
  return (err: unknown) => {
    console.error(context, err);
    notify.error(context, err instanceof Error ? err.message : String(err));
  };
}
