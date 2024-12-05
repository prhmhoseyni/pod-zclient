interface ZClient {
    client: string;
    connectionString: string;
    username: string;
    password: string;
    path: string;
    encryptionSecretKey: string;
    logger?: (data: unknown) => void;
    onUpdateConfigurations?: () => void;
}

export function zclient(payload: ZClient) {
    return payload;
}
