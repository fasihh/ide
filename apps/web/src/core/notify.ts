import { toast } from "sonner";
import type { NotifyAction, NotifyApi } from "@cp-ide/plugin-api/web";

const opts = (description?: string, action?: NotifyAction) => ({
  description,
  action: action && { label: action.label, onClick: () => void action.run() },
  duration: action ? 8000 : undefined,
});

export const notify: NotifyApi = {
  info: (message, description, action) => toast(message, opts(description, action)),
  success: (message, description, action) => toast.success(message, opts(description, action)),
  error: (message, description, action) => toast.error(message, opts(description, action)),
};

export function reportError(context: string) {
  return (err: unknown) => {
    console.error(context, err);
    notify.error(context, err instanceof Error ? err.message : String(err));
  };
}
