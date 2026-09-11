import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import * as svc from "./bot-service.server";
import { listOverview, adminOverview, botDetail, botLogs, botDeployments, botMedia } from "./bot-queries.server";

const uuid = z.string().uuid();

export const syncProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await svc.ensureProfile(context.supabase, context.userId, (context.claims as { email?: string })?.email ?? null);
    return { ok: true };
  });

export const validateBotToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { token: string }) => z.object({ token: z.string().min(20).max(200) }).parse(d))
  .handler(({ data, context }) => svc.validateToken(context.userId, data.token));

export const createBotFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        name: z.string().trim().min(2).max(60),
        token: z.string().trim().min(20).max(200),
        ownerTelegramId: z.number().int().positive().nullable().optional(),
        storageChannelId: z.number().int().nullable().optional(),
        env: z.array(z.object({ key: z.string().regex(/^[A-Z0-9_]{1,64}$/), value: z.string().max(4000) })).max(50).optional(),
      })
      .parse(d),
  )
  .handler(({ data, context }) => svc.createBot(context.supabase, context.userId, data));

export const verifyStorageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ botId: uuid, chatId: z.number().int() }).parse(d))
  .handler(({ data, context }) => svc.verifyStorage(context.supabase, data.botId, data.chatId));

export const uploadProjectFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ botId: uuid, fileName: z.string().max(200), zipBase64: z.string().min(10).max(21_000_000) }).parse(d),
  )
  .handler(({ data, context }) =>
    svc.uploadProject(context.supabase, context.userId, data.botId, data.zipBase64, data.fileName),
  );

export const deployBotFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ botId: uuid, versionId: uuid.optional() }).parse(d))
  .handler(({ data, context }) =>
    svc.deployBot(context.supabase, context.userId, data.botId, getRequest().url, data.versionId),
  );

export const stopWebhookFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ botId: uuid }).parse(d))
  .handler(({ data, context }) => svc.stopWebhookForBot(context.supabase, context.userId, data.botId));

export const startBotFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ botId: uuid }).parse(d))
  .handler(({ data, context }) =>
    svc.startBot(context.supabase, context.userId, data.botId, getRequest().url),
  );

export const restartBotFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ botId: uuid }).parse(d))
  .handler(({ data, context }) =>
    svc.restartBot(context.supabase, context.userId, data.botId, getRequest().url),
  );


export const refreshWebhookFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ botId: uuid }).parse(d))
  .handler(({ data, context }) => svc.refreshWebhookInfo(context.supabase, data.botId));

export const testBotFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ botId: uuid }).parse(d))
  .handler(({ data, context }) => svc.testBot(context.supabase, context.userId, data.botId, getRequest().url));

export const sendTestMessageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ botId: uuid, chatId: z.number().int(), text: z.string().max(1000) }).parse(d),
  )
  .handler(({ data, context }) =>
    svc.sendTestMessage(context.supabase, context.userId, data.botId, data.chatId, data.text),
  );

export const deleteBotFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ botId: uuid }).parse(d))
  .handler(({ data, context }) => svc.deleteBot(context.supabase, context.userId, data.botId));

export const setEnvVarFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ botId: uuid, key: z.string().regex(/^[A-Z0-9_]{1,64}$/), value: z.string().max(4000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await svc.assertOwner(context.supabase, data.botId);
    await svc.setEnvVar(data.botId, data.key, data.value);
    await svc.audit(context.userId, data.botId, "ENV_UPDATED", `Variable ${data.key} updated`);
    return { ok: true };
  });

export const listEnvKeysFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ botId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await svc.assertOwner(context.supabase, data.botId);
    return svc.listEnvKeys(data.botId);
  });

// ---------- reads ----------
export const dashboardOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => listOverview(context.supabase));

export const getBotDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ botId: uuid }).parse(d))
  .handler(({ data, context }) => botDetail(context.supabase, data.botId, getRequest().url));

export const getBotLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ botId: uuid, level: z.string().optional(), event: z.string().optional() }).parse(d),
  )
  .handler(({ data, context }) => botLogs(context.supabase, data.botId, data.level, data.event));

export const getBotDeployments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ botId: uuid }).parse(d))
  .handler(({ data, context }) => botDeployments(context.supabase, data.botId));

export const getBotMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ botId: uuid }).parse(d))
  .handler(({ data, context }) => botMedia(context.supabase, data.botId));

export const getAdminOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => adminOverview(context.supabase, context.userId));
