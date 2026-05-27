import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SignerResponse = {
    prompt: string;
    ts: number;
    sig: string;
};

type JobResponse = {
    job_id: string;
    res_prompt?: string;
    status?: string;
};

type WsMessage = {
    type?: string;
    message?: string;
    image_data?: string;
    [key: string]: unknown;
};

function json(data: unknown, status = 200) {
    return NextResponse.json(data, { status });
}

async function createWebSocketAuth(jobId: string) {
    const timestamp = Math.floor(Date.now() / 1000);
    const message = jobId + timestamp;

    const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(message)
    );

    const hashHex = Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    const authPrefix = Buffer.from(hashHex).toString("base64").substring(0, 20);

    return `${authPrefix}:${timestamp}`;
}

async function readJsonSafe(res: Response) {
    const text = await res.text();

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
    let timer: NodeJS.Timeout;

    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });

    return Promise.race([promise, timeout]).finally(() => {
        clearTimeout(timer!);
    });
}

async function waitImageFromWebSocket(jobId: string) {
    const WebSocket = (await import("ws")).default;

    const auth = await createWebSocketAuth(jobId);

    return await withTimeout(
        new Promise<{ image_data: string; logs: WsMessage[] }>((resolve, reject) => {
            const logs: WsMessage[] = [];

            const ws = new WebSocket("wss://websocket-bridge.freegen.app/ws", {
                headers: {
                    Origin: "https://freegen.app",
                    "User-Agent":
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
                },
            });

            ws.on("open", () => {
                const payload = {
                    type: "subscribe",
                    job_id: jobId,
                    auth,
                };

                ws.send(JSON.stringify(payload));
            });

            ws.on("message", (raw) => {
                try {
                    const data = JSON.parse(raw.toString()) as WsMessage;
                    logs.push(data);

                    if (data.type === "result" && typeof data.image_data === "string") {
                        ws.close();
                        resolve({
                            image_data: data.image_data,
                            logs,
                        });
                    }
                } catch (err) {
                    ws.close();
                    reject(err);
                }
            });

            ws.on("error", (err) => {
                reject(err);
            });

            ws.on("close", () => {
                // 如果已经 resolve，不会影响；如果没结果，交给 timeout。
            });
        }),
        60_000,
        "WebSocket timeout: 60s 内没有收到图片结果"
    );
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        const prompt = String(body.prompt || "").trim();
        const ratio_id = String(body.ratio_id || "16:9");

        if (!prompt) {
            return json(
                {
                    ok: false,
                    error: "prompt 不能为空",
                },
                400
            );
        }

        const signerRes = await fetch("https://prompt-signer.freegen.app/", {
            method: "POST",
            headers: {
                accept: "*/*",
                "content-type": "application/json",
                origin: "https://freegen.app",
                referer: "https://freegen.app/",
                "user-agent":
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
            },
            body: JSON.stringify({ prompt }),
            cache: "no-store",
        });

        const signerData = (await readJsonSafe(signerRes)) as SignerResponse;

        if (!signerRes.ok || !signerData?.sig || !signerData?.ts) {
            return json(
                {
                    ok: false,
                    step: "signer",
                    status: signerRes.status,
                    response: signerData,
                },
                502
            );
        }

        const jobRes = await fetch("https://image-generator.freegen.app/", {
            method: "POST",
            headers: {
                accept: "*/*",
                "content-type": "application/json",
                origin: "https://freegen.app",
                referer: "https://freegen.app/",
                "user-agent":
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
            },
            body: JSON.stringify({
                prompt,
                ts: signerData.ts,
                sig: signerData.sig,
                ratio_id,
            }),
            cache: "no-store",
        });

        const jobData = (await readJsonSafe(jobRes)) as JobResponse;

        if (!jobRes.ok || !jobData?.job_id) {
            return json(
                {
                    ok: false,
                    step: "create_job",
                    status: jobRes.status,
                    response: jobData,
                },
                502
            );
        }

        const result = await waitImageFromWebSocket(jobData.job_id);

        return json({
            ok: true,
            job_id: jobData.job_id,
            image_data: result.image_data,
            logs: result.logs,
        });
    } catch (err) {
        return json(
            {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
            },
            500
        );
    }
}