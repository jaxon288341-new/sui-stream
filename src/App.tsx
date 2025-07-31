import React, { useState } from 'react';
import { ConnectButton, useCurrentWallet, useSignAndExecuteTransactionBlock } from '@mysten/dapp-kit';
import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { useQuery, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Clock, Droplets, Waves, User, DollarSign, Zap } from 'lucide-react';

const PACKAGE_ID = process.env.REACT_APP_PACKAGE_ID || "0xYOUR_PACKAGE_ID";
const GLOBAL_STATE_ID = process.env.REACT_APP_GLOBAL_STATE_ID || "0xYOUR_GLOBAL_STATE_ID";

const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });
const queryClient = new QueryClient();

const AppWrapper = () => (
    <QueryClientProvider client={queryClient}>
        <App />
    </QueryClientProvider>
);

const App: React.FC = () => {
    const { currentWallet, connectionStatus } = useCurrentWallet();
    const { mutate: signAndExecute } = useSignAndExecuteTransactionBlock();
    
    const [fillAmount, setFillAmount] = useState('1');
    const [waterAmount, setWaterAmount] = useState('1');
    const [isActionLoading, setIsActionLoading] = useState(false);
    const [message, setMessage] = useState<{text: string, type: 'success' | 'error'} | null>(null);

    const { data: globalState, isLoading: isGlobalStateLoading } = useQuery({
        queryKey: ['globalState', GLOBAL_STATE_ID],
        queryFn: async () => {
            if (!GLOBAL_STATE_ID || GLOBAL_STATE_ID === "0xYOUR_GLOBAL_STATE_ID") return null;
            const object = await suiClient.getObject({ id: GLOBAL_STATE_ID, options: { showContent: true } });
            return object.data?.content?.['fields'] as any;
        },
        enabled: !!GLOBAL_STATE_ID && GLOBAL_STATE_ID !== "0xYOUR_GLOBAL_STATE_ID",
        refetchInterval: 5000,
    });

    const { data: userState, isLoading: isUserStateLoading } = useQuery({
        queryKey: ['userState', currentWallet?.address],
        queryFn: async () => {
            if (!currentWallet?.address || !PACKAGE_ID || PACKAGE_ID === "0xYOUR_PACKAGE_ID") return null;
            const objects = await suiClient.getOwnedObjects({
                owner: currentWallet.address,
                filter: { StructType: `${PACKAGE_ID}::suistream::UserState` },
                options: { showContent: true },
            });
            if (objects.data.length > 0) {
                return {
                    id: objects.data[0].data?.objectId,
                    ...objects.data[0].data?.content?.['fields']
                } as any;
            }
            return null;
        },
        enabled: connectionStatus === 'connected' && !!PACKAGE_ID && PACKAGE_ID !== "0xYOUR_PACKAGE_ID",
        refetchInterval: 5000,
    });

    const handleAction = (txb: TransactionBlock, successMessage: string) => {
        setIsActionLoading(true);
        setMessage(null);
        signAndExecute(
            { transactionBlock: txb },
            {
                onSuccess: (result) => {
                    console.log('Transaction successful:', result);
                    setMessage({ text: successMessage, type: 'success' });
                    queryClient.invalidateQueries({ queryKey: ['globalState'] });
                    queryClient.invalidateQueries({ queryKey: ['userState'] });
                },
                onError: (error) => {
                    console.error('Transaction failed:', error);
                    setMessage({ text: error.message || 'Transaction failed.', type: 'error' });
                },
                onSettled: () => setIsActionLoading(false),
            }
        );
    };

    const createAccount = () => {
        const txb = new TransactionBlock();
        txb.moveCall({
            target: `${PACKAGE_ID}::suistream::create_user_state`,
            arguments: [txb.object(GLOBAL_STATE_ID), txb.object('0x6')],
        });
        handleAction(txb, 'Account created successfully! You can now Fill and Water.');
    };

    const handleFill = () => {
        if (!userState) return;
        const txb = new TransactionBlock();
        const amount = Math.floor(parseFloat(fillAmount) * 1_000_000_000);
        const [coin] = txb.splitCoins(txb.gas, [txb.pure(amount)]);
        txb.moveCall({
            target: `${PACKAGE_ID}::suistream::fill`,
            arguments: [txb.object(GLOBAL_STATE_ID), txb.object(userState.id), coin, txb.object('0x6')],
        });
        handleAction(txb, `Successfully filled ${fillAmount} SUI!`);
    };

    const handleWater = () => {
        if (!userState) return;
        const txb = new TransactionBlock();
        const amount = Math.floor(parseFloat(waterAmount) * 1_000_000_000);
        const [coin] = txb.splitCoins(txb.gas, [txb.pure(amount)]);
        txb.moveCall({
            target: `${PACKAGE_ID}::suistream::water`,
            arguments: [txb.object(GLOBAL_STATE_ID), txb.object(userState.id), coin],
        });
        handleAction(txb, `Successfully watered ${waterAmount} SUI!`);
    };

    const handleTap = () => {
        if (!userState) return;
        const txb = new TransactionBlock();
        txb.moveCall({
            target: `${PACKAGE_ID}::suistream::tap`,
            arguments: [txb.object(GLOBAL_STATE_ID), txb.object(userState.id), txb.object('0x6')],
        });
        handleAction(txb, 'Rewards tapped successfully! Check your wallet.');
    };
    
    const StatCard = ({ icon, label, value, isLoading }) => (
        <div className="bg-white/10 backdrop-blur-sm p-4 rounded-lg flex items-center space-x-4 shadow-lg">
            <div className="bg-cyan-400/20 p-3 rounded-full">{icon}</div>
            <div>
                <p className="text-sm text-blue-200">{label}</p>
                <p className="text-xl font-bold">{isLoading ? '...' : value}</p>
            </div>
        </div>
    );

    const formatSui = (val: string | number | undefined) => {
        if (val === undefined) return '0.0000';
        return (parseInt(val as string) / 1_000_000_000).toFixed(4);
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-black text-white font-sans">
            <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20100%20100%22%3E%3Cpath%20d%3D%27M0%2C50%20Q25%2C25%2050%2C50%20T100%2C50%27%20stroke%3D%27rgba(255%2C255%2C255%2C0.05)%27%20fill%3D%27none%27%2F%3E%3Cpath%20d%3D%27M0%2C50%20Q25%2C75%2050%2C50%20T100%2C50%27%20stroke%3D%27rgba(255%2C255%2F255%2C0.05)%27%20fill%3D%27none%27%2F%3E%3C%2Fsvg%3E')] bg-repeat opacity-50"></div>
            <div className="relative container mx-auto p-4 sm:p-8">
                <header className="flex justify-between items-center mb-8">
                    <div className="flex items-center space-x-3">
                        <Waves className="h-10 w-10 text-cyan-300"/>
                        <h1 className="text-4xl font-bold tracking-tighter">SuiStream</h1>
                    </div>
                    <ConnectButton />
                </header>

                {message && (
                    <div className={`p-4 mb-4 rounded-lg shadow-md ${message.type === 'success' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
                        {message.text}
                    </div>
                )}

                {connectionStatus === 'connected' ? (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                            <StatCard icon={<User size={24} />} label="Total Users" value={globalState?.total_users} isLoading={isGlobalStateLoading} />
                            <StatCard icon={<Droplets size={24} />} label="Total Filled" value={globalState ? `${formatSui(globalState.total_filled)} SUI` : '...'} isLoading={isGlobalStateLoading} />
                            <StatCard icon={<Zap size={24} />} label="Total Watered" value={globalState ? `${formatSui(globalState.total_watered)} SUI` : '...'} isLoading={isGlobalStateLoading} />
                            <StatCard icon={<DollarSign size={24} />} label="Rewards Pool" value={globalState ? `${formatSui(globalState.total_rewards.fields.balance)} SUI` : '...'} isLoading={isGlobalStateLoading} />
                        </div>
                        
                        {isUserStateLoading ? <p className="text-center">Loading your stream...</p> : userState ? (
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                <ActionCard title="Fill" icon={<Droplets />} onSubmit={handleFill} amount={fillAmount} setAmount={setFillAmount} isLoading={isActionLoading} description="Add SUI to your stream and the global pool."/>
                                <ActionCard title="Water" icon={<Zap />} onSubmit={handleWater} amount={waterAmount} setAmount={setWaterAmount} isLoading={isActionLoading} description="Compound SUI to increase your influence."/>
                                <div className="bg-white/10 backdrop-blur-sm p-6 rounded-lg flex flex-col justify-between shadow-lg">
                                    <div>
                                        <h3 className="text-2xl font-bold mb-4">Your Stats</h3>
                                        <p>Filled: <span className="font-mono">{formatSui(userState.filled_amount)} SUI</span></p>
                                        <p>Watered: <span className="font-mono">{formatSui(userState.watered_amount)} SUI</span></p>
                                        <p>Last Claim: <span className="font-mono">{new Date(parseInt(userState.last_claim_time_ms)).toLocaleString()}</span></p>
                                    </div>
                                    <button onClick={handleTap} disabled={isActionLoading} className="w-full mt-4 bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-500 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 shadow-cyan-500/50 hover:shadow-cyan-400/60">
                                        {isActionLoading ? 'Tapping...' : 'Tap Rewards'}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center bg-white/10 p-8 rounded-lg shadow-lg">
                                <h2 className="text-2xl mb-4">Welcome to the Stream!</h2>
                                <p className="mb-6 text-blue-200">Create your user account to start playing.</p>
                                <button onClick={createAccount} disabled={isActionLoading} className="bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-6 rounded-lg transition-all duration-200 shadow-green-500/50 hover:shadow-green-400/60">
                                    {isActionLoading ? 'Creating...' : 'Create Account'}
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="text-center bg-white/10 p-12 rounded-lg shadow-lg">
                        <h2 className="text-3xl mb-4">Connect Your Wallet</h2>
                        <p className="text-blue-200">Connect your Sui wallet to dive into the stream and start earning rewards.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

const ActionCard = ({ title, icon, onSubmit, amount, setAmount, isLoading, description }) => (
    <div className="bg-white/10 backdrop-blur-sm p-6 rounded-lg shadow-lg">
        <div className="flex items-center space-x-3 mb-4">
            {icon}
            <h3 className="text-2xl font-bold">{title}</h3>
        </div>
        <p className="text-sm text-blue-200 mb-4 h-10">{description}</p>
        <div className="flex items-center space-x-2 mb-4">
            <input 
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-black/20 p-3 rounded-lg border border-white/20 focus:ring-2 focus:ring-cyan-400 focus:outline-none"
                placeholder="Amount in SUI"
            />
            <span className="font-bold">SUI</span>
        </div>
        <button onClick={onSubmit} disabled={isLoading} className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-gray-500 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 shadow-blue-500/50 hover:shadow-blue-400/60">
            {isLoading ? 'Processing...' : title}
        </button>
    </div>
);


export default AppWrapper;
