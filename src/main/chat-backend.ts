import { BrowserWindow } from "electron";
import { request } from "https";

export interface ProviderConfig {
  id: string; name: string; baseUrl: string;
  apiKey: string; models: string[]; headers: Record<string, string>;
}

export interface ChatRequest {
  provider: ProviderConfig; model: string;
  messages: { role: string; content: string }[];
}

export async function streamChatCompletion(
  req: ChatRequest, window: BrowserWindow,
  onDone: (fullText: string, tokens: number) => void
): Promise<void> {
  var p = req.provider;
  var model = req.model;
  var messages = req.messages;
  var LF = String.fromCharCode(10);

  var baseUrl = p.baseUrl.replace(/\/+$/, "");
  if (baseUrl.indexOf("/v1") === -1) baseUrl += "/v1";
  var url = baseUrl + "/chat/completions";
  var urlObj = new URL(url);

  var body = JSON.stringify({ model: model, messages: messages, stream: true });

  var headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + p.apiKey,
  };
  if (p.headers) {
    for (var k in p.headers) headers[k] = p.headers[k];
  }

  var options = {
    hostname: urlObj.hostname, port: urlObj.port || 443,
    path: urlObj.pathname + urlObj.search,
    method: "POST", headers: headers,
  };

  return new Promise(function(resolve, reject) {
    var req2 = request(options, function(res) {
      if (res.statusCode !== 200) {
        var eb = "";
        res.on("data", function(c: Buffer) { eb += c.toString(); });
        res.on("end", function() {
          window.webContents.send("chat:error", {
            message: "HTTP " + res.statusCode + ": " + eb.slice(0, 300)
          });
          reject(new Error("HTTP " + res.statusCode));
        });
        return;
      }

      var fullText = "";
      var tokenCount = 0;
      var buf = "";

      res.on("data", function(chunk: Buffer) {
        buf += chunk.toString();
        var lines = buf.split(LF);
        buf = lines.pop() || "";

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line || line.indexOf("data: ") !== 0) continue;
          var jsonStr = line.slice(6);
          if (jsonStr === "[DONE]") continue;
          try {
            var parsed = JSON.parse(jsonStr);
            var delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;
            if (delta.content) {
              fullText += delta.content;
              window.webContents.send("chat:stream-token", {
                text: delta.content, fullText: fullText
              });
            }
            if (parsed.usage) {
              tokenCount = parsed.usage.total_tokens || tokenCount;
            }
          } catch(e) {}
        }
      });

      res.on("end", function() {
        onDone(fullText, tokenCount);
        resolve();
      });

      res.on("error", function(err: Error) {
        window.webContents.send("chat:error", { message: "Stream: " + err.message });
        reject(err);
      });
    });

    req2.on("error", function(err: Error) {
      window.webContents.send("chat:error", { message: "Request: " + err.message });
      reject(err);
    });

    req2.write(body);
    req2.end();
  });
}