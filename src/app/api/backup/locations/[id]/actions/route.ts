import { serverT } from "@/lib/i18n/runtime";
import { attemptLogin } from "@/lib/auth/login";
import { refreshRepoStats } from "@/lib/backup/engine";
import { backupGuard, describe, fail, invalid, readBody, record } from "@/lib/backup/http";
import { recoveryKit } from "@/lib/backup/kit";
import { getRepo, repoPassword, repoSecrets, setVerifyCron } from "@/lib/backup/store/repos";
import { testRepo, unlockRepo, verifyRepo } from "@/lib/backup/verify";
import { runWithHost } from "@/lib/hosts/context";
import { clientIp } from "@/lib/request";

export const dynamic = "force-dynamic";

/**
 * Konum eylemleri: sına, doğrula (geri yükleme testi), kilidi aç, istatistik,
 * doğrulama takvimi, parolayı göster, kurtarma kiti.
 *
 * Parola ve kit oturum parolasının yeniden girilmesini ister: açık bir
 * oturumu ele geçiren biri yedeklerin anahtarını tek tıkla alamasın.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await backupGuard(request);
  if (!guard.ok) return guard.response;
  const id = Number((await params).id);
  const repo = getRepo(id);
  if (!repo) return fail(serverT("api.notFound.repo"), 404);

  const body = await readBody(request);
  if (!body) return invalid();
  const action = String(body.action ?? "");
  const actor = guard.session.user.username;

  const reauth = () => {
    const password = typeof body.currentPassword === "string" ? body.currentPassword : "";
    return attemptLogin(guard.session.user.username, password, clientIp(request)).ok;
  };

  try {
    switch (action) {
      case "test":
        return Response.json(await testRepo(id));

      case "verify": {
        // Büyük depolarda dakikalar sürer: arka planda; ilerleme canlı akışta.
        const hostId = guard.hostId;
        record(guard, "backup.location.verify", repo.name, { targetType: "backup_repo", targetId: id });
        void runWithHost(hostId, () => verifyRepo(id, actor)).catch((error) =>
          console.error(`[backup] doğrulama ${repo.name}:`, error),
        );
        return Response.json({ started: true }, { status: 202 });
      }

      case "unlock": {
        const outcome = await unlockRepo(id);
        record(guard, "backup.location.unlock", repo.name, { targetType: "backup_repo", targetId: id, ok: outcome.ok });
        return Response.json(outcome);
      }

      case "stats": {
        const secrets = repoSecrets(id);
        if (!secrets) return fail(serverT("api.backup.repoPasswordMaster"));
        await refreshRepoStats(secrets);
        return Response.json({ ok: true, location: getRepo(id) });
      }

      case "verifySchedule":
        setVerifyCron(id, String(body.cron ?? ""));
        return Response.json({ ok: true });

      case "password": {
        if (!reauth()) return fail(serverT("api.auth.currentPasswordWrong"), 401);
        const password = repoPassword(id);
        if (!password) return fail(serverT("api.backup.repoPasswordMaster"));
        record(guard, "backup.location.password", repo.name, { targetType: "backup_repo", targetId: id });
        return Response.json({ password });
      }

      case "kit": {
        if (!reauth()) return fail(serverT("api.auth.currentPasswordWrong"), 401);
        const kit = recoveryKit(id, body.includeMasterKey === true);
        if (!kit) return fail(serverT("api.backup.repoPasswordMaster"));
        record(guard, "backup.location.kit", `${repo.name}${body.includeMasterKey === true ? " +MASTER_KEY" : ""}`, {
          targetType: "backup_repo",
          targetId: id,
        });
        return new Response(kit.text, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "content-disposition": `attachment; filename="${kit.fileName}"`,
            "cache-control": "no-store",
          },
        });
      }

      default:
        return invalid();
    }
  } catch (error) {
    return fail(describe(error), 500);
  }
}
