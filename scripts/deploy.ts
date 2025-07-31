import { TransactionBlock } from '@mysten/sui.js/transactions';
import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const client = new SuiClient({ url: getFullnodeUrl('testnet') });
const keypair = Ed25519Keypair.fromSecretKey(Buffer.from(process.env.ADMIN_SECRET_KEY, 'hex'));

async function deploy() {
    console.log("Deploying from address:", keypair.getPublicKey().toSuiAddress());
    
    const packagePath = path.join(__dirname, '../contracts');
    const { modules, dependencies } = JSON.parse(
        execSync(`sui move build --dump-bytecode-as-base64 --path ${packagePath}`, { encoding: 'utf-8' })
    );

    const txb = new TransactionBlock();
    const [upgradeCap] = txb.publish({ modules, dependencies });
    
    txb.transferObjects([upgradeCap], txb.pure(keypair.getPublicKey().toSuiAddress()));
    
    const result = await client.signAndExecuteTransactionBlock({
        signer: keypair,
        transactionBlock: txb,
        options: { showEffects: true, showObjectChanges: true },
    });

    if (result.effects?.status.status !== 'success') {
        console.error('Deployment failed:', result.effects?.status.error);
        return;
    }
    
    console.log('Deployment Result Digest:', result.digest);

    const packageId = result.objectChanges.find(o => o.type === 'published')?.packageId;
    const globalStateId = result.objectChanges.find(o => o.type === 'created' && o.objectType.endsWith('::suistream::GlobalState'))?.objectId;
    const adminCapId = result.objectChanges.find(o => o.type === 'created' && o.objectType.endsWith('::suistream::AdminCap'))?.objectId;

    console.log('----------------------------------');
    console.log('✅ Deployment Successful!');
    console.log('Package ID:', packageId);
    console.log('Global State ID:', globalStateId);
    console.log('Admin Cap ID:', adminCapId);
    console.log('----------------------------------');
    
    const envContent = `REACT_APP_PACKAGE_ID=${packageId}\nREACT_APP_GLOBAL_STATE_ID=${globalStateId}`;
    fs.writeFileSync(path.join(__dirname, '../.env'), envContent);
    console.log('✅ .env file created for frontend.');
}

deploy().catch(console.error);
