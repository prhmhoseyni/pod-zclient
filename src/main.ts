import zookeeper from "node-zookeeper-client";
import type { Client } from "node-zookeeper-client";


/**
 * ---------------------------------------------------------------------------------------------------------------------
 * :::: types ::::
 */
interface ZClientConfig {
    client: string;
    connectionString: string;
    username: string;
    password: string;
    path: string;
    encryptionSecretKey: string;
    logger?: (data: unknown) => void;
    onUpdateConfigurations?: () => void;
}

/**
 * ---------------------------------------------------------------------------------------------------------------------
 * :::: zookeeper client class ::::
 */
class ZookeeperClient {

    private static instance: ZookeeperClient;
    readonly client!: Client;
    readonly connection_string!: string;
    readonly username!: string;
    readonly password!: string;
    readonly path!: string;
    readonly encryption_secret_key!: string;
    readonly logger?: (data: unknown) => void;
    readonly on_update_configurations?: () => void;

    /**
     * -----------------------------------------------------------------------------------------------------------------
     */
    constructor(config: ZClientConfig) {

        // config singleton class
        if (ZookeeperClient.instance) {
            return ZookeeperClient.instance;
        }

        ZookeeperClient.instance = this;

        // initialize instance
        this.connection_string = config.connectionString;
        this.username = config.username;
        this.password = config.password;
        this.path = config.path;
        this.encryption_secret_key = config.encryptionSecretKey;
        this.logger = config.logger
        this.on_update_configurations = config.onUpdateConfigurations

        // create zookeeper client instance
        this.client = zookeeper.createClient(this.connection_string, {sessionTimeout: 30000});
        this.client.addAuthInfo("digest", Buffer.from(`${this.username}:${this.password}`));
    }

    /**
     * -----------------------------------------------------------------------------------------------------------------
     */
    run() {
        return new Promise<void>(async (resolve) => {
            try {
                // connect to zookeeper
                await this.connect();

                // log zookeeper events
                await this.events();

                // fetch config from zookeeper
                await this.fetch_config();

                resolve();
            } catch (error) {
                console.log({
                    type: "ZOOKEEPER",
                    level: "ERROR",
                    message: (error as Error)?.message,
                    description: "unhandled error",
                });

                await this.retry();
            }
        });
    }

    /**
     * -----------------------------------------------------------------------------------------------------------------
     */
    connect() {
        return new Promise<void>(async (resolve) => {
            try {
                this.client.once("connected", () => {
                    console.log({
                        type: "ZOOKEEPER",
                        level: "INFO",
                        message: "✅ connected to zookeeper",
                        description: "",
                    });

                    resolve();
                });

                this.client.connect();
            } catch (error) {
                console.log({
                    type: "ZOOKEEPER",
                    level: "ERROR",
                    message: (error as Error)?.message,
                    description: "connect",
                });

                await this.retry();
            }
        });
    }

    /**
     * -----------------------------------------------------------------------------------------------------------------
     */
    events() {
        // disconnected events
        this.client.on("disconnected", () => {
            console.log({
                type: "ZOOKEEPER",
                level: "INFO",
                message: "disconnected from zookeeper",
                description: "",
            });
        });

        // expired session events
        this.client.on("expired", async () => {
            console.log({
                type: "ZOOKEEPER",
                level: "INFO",
                message: "zookeeper session expired",
                description: "",
            });

            await this.retry();
        });

        // error events
        // @ts-ignore
        this.client.on("error", (error: string) => {
            console.log({
                type: "ZOOKEEPER",
                level: "INFO",
                message: error,
                description: "error on zookeeper",
            });
        });

    }

    /**
     * -----------------------------------------------------------------------------------------------------------------
     */
    retry() {
        return new Promise<void>(async (resolve) => {
            this.client.close();
            await this.run();
            resolve();
        });
    }

    /**
     * -----------------------------------------------------------------------------------------------------------------
     */
    fetch_config() {
        return new Promise<void>((resolve) => {
            try {
                this.client.getData(
                    this.path,
                    async event => {
                        console.log({
                            type: "ZOOKEEPER",
                            level: "INFO",
                            message: typeof event === "string" ? event : JSON.stringify(event),
                            description: "event received in get data",
                        });

                        if (event.type === 3 && event.name === "NODE_DATA_CHANGED") {
                            await this.fetch_config();
                        }
                    },
                    async (error, data) => {
                        if (error) {
                            console.log({
                                type: "ZOOKEEPER",
                                level: "ERROR",
                                message: error,
                                description: "error event received in get data",
                            });

                            return this.retry();
                        }

                        console.log({
                            type: "ZOOKEEPER",
                            level: "INFO",
                            message: "fetched data",
                            description: "",
                        });

                        await this.parse_loaded_data(data);

                        console.log({
                            type: "ZOOKEEPER",
                            level: "INFO",
                            message: "parsed data",
                            description: "",
                        });

                        resolve();
                    },
                );
            } catch (error) {
                console.log({
                    type: "ZOOKEEPER",
                    level: "ERROR",
                    message: (error as Error)?.message,
                    description: "fetch config",
                });

                return this.retry();
            }
        });
    }

    /**
     * -----------------------------------------------------------------------------------------------------------------
     */
    parse_loaded_data(data: any) {
        return new Promise<void>(async (resolve) => {
            try {
                const parsed_data =
                    data
                        .toString("utf8")
                        .split("\r\n")
                        .filter((item: string) => Boolean(item) && !item.startsWith("#")) ?? [];

                parsed_data.forEach((item: string) => {
                    const [key, value] = item.split("=").map(item => item.trim());
                    process.env[key] = value.startsWith("devEnc:") ? this.decrypt_value(value) : value;
                });

                resolve();
            } catch (error) {
                console.log({
                    type: "ZOOKEEPER",
                    level: "ERROR",
                    message: (error as Error)?.message,
                    description: "parse data",
                });
            }
        });
    }

    /**
     * -----------------------------------------------------------------------------------------------------------------
     */
    decrypt_value(encryptedText: string) {
        encryptedText = encryptedText.replace("devEnc:", "");

        const key = Buffer.from(this.encryption_secret_key, "hex");
        const iv = Buffer.from(encryptedText.slice(0, 32), "hex");
        const encrypted = Buffer.from(encryptedText.slice(32), "hex");

        // @ts-expect-error
        const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
        let decrypted = decipher.update(encrypted, "hex", "utf8");
        decrypted += decipher.final("utf8");

        return decrypted;
    }
}

/**
 * ---------------------------------------------------------------------------------------------------------------------
 * :::: run zookeeper ::::
 */
let is_running_zookeeper = false;

function run_zookeeper(config: ZClientConfig) {
    return new Promise<void>(async (resolve, reject) => {
        if (!is_running_zookeeper) {
            try {
                const zookeeperClient = new ZookeeperClient(config);
                await zookeeperClient.run();
                resolve();
            } catch (error) {
                console.log({
                    type: "ZOOKEEPER",
                    level: "ERROR",
                    message: `run zookeeper >>>> ${(error as Error).message}`,
                    description: "",
                });
                reject();
            }
        } else {
            resolve();
        }
    });
}

export default run_zookeeper;
