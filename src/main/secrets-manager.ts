/**
 * SecretsManager — stores API keys encrypted at rest using Electron safeStorage.
 *
 * Keys never live in renderer localStorage. The renderer references a secret by
 * id; the actual key material is held in the main process and persisted
 * encrypted (OS keychain-backed where available, e.g. DPAPI on Windows,
 * Keychain on macOS, libsecret on Linux).
 */
import { app, safeStorage } from "electron";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

export class SecretsManager {
  private filePath: string;
  // id -> base64(encrypted bytes) when encryption available, else id -> plaintext
  private store: Record<string, string> = {};
  private loaded = false;
  private encryptionAvailable = false;

  constructor() {
    this.filePath = join(app.getPath("userData"), "ue-coworker-secrets.json");
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.encryptionAvailable = safeStorage.isEncryptionAvailable();
    try {
      if (existsSync(this.filePath)) {
        const raw = await readFile(this.filePath, "utf-8");
        this.store = JSON.parse(raw) || {};
      }
    } catch {
      this.store = {};
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const dir = join(this.filePath, "..");
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.store, null, 2), "utf-8");
  }

  async setSecret(id: string, value: string): Promise<void> {
    await this.load();
    if (!value) {
      delete this.store[id];
    } else if (this.encryptionAvailable) {
      this.store[id] = "enc:" + safeStorage.encryptString(value).toString("base64");
    } else {
      // Fallback: no OS encryption available — store as-is but flag it.
      this.store[id] = "raw:" + value;
    }
    await this.persist();
  }

  async getSecret(id: string): Promise<string> {
    await this.load();
    const stored = this.store[id];
    if (!stored) return "";
    if (stored.indexOf("enc:") === 0) {
      try {
        return safeStorage.decryptString(Buffer.from(stored.slice(4), "base64"));
      } catch {
        return "";
      }
    }
    if (stored.indexOf("raw:") === 0) return stored.slice(4);
    return stored;
  }

  async hasSecret(id: string): Promise<boolean> {
    await this.load();
    return !!this.store[id];
  }

  async deleteSecret(id: string): Promise<void> {
    await this.load();
    delete this.store[id];
    await this.persist();
  }
}
