#[allow(unused_use)]
module suistream::suistream {
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::sui::SUI;
    use sui::tx_context::{Self, TxContext};
    use sui::object::{Self, UID, ID};
    use sui::transfer;
    use sui::event;
    use sui::clock::{Self, Clock};

    const E_NOT_ADMIN: u64 = 1;
    const E_INSUFFICIENT_FUNDS: u64 = 2;
    const E_INVALID_ACTION: u64 = 3;

    #[derive(key, store)]
    struct GlobalState has key, store {
        id: UID,
        total_rewards: Balance<SUI>,
        total_users: u64,
        total_filled: u64,
        total_watered: u64,
        dev_address: address,
        marketing_address: address,
        fill_dev_fee_bps: u64,
        fill_marketing_fee_bps: u64,
        water_dev_fee_bps: u64,
        water_marketing_fee_bps: u64,
        tap_dev_fee_bps: u64,
        tap_early_penalty_bps: u64,
        tap_late_bonus_bps: u64,
        admin_cap: ID,
    }

    #[derive(key, store)]
    struct UserState has key, store {
        id: UID,
        user: address,
        filled_amount: u64,
        watered_amount: u64,
        last_fill_time_ms: u64,
        last_claim_time_ms: u64,
    }

    #[derive(key, store)]
    struct AdminCap has key, store {
        id: UID
    }

    #[derive(copy, drop)]
    struct UserCreated { user: address, user_state_id: ID }
    #[derive(copy, drop)]
    struct Filled { user: address, amount_sui: u64, net_fill_increase: u64 }
    #[derive(copy, drop)]
    struct Watered { user: address, amount_sui: u64, net_water_increase: u64 }
    #[derive(copy, drop)]
    struct Tapped { user: address, gross_reward: u64, user_reward: u64, dev_fee: u64, pool_refill: u64 }

    const DAY_MS: u64 = 86_400_000;

    fun init(ctx: &mut TxContext) {
        let admin_cap = AdminCap { id: object::new(ctx) };

        let state = GlobalState {
            id: object::new(ctx),
            total_rewards: balance::zero(),
            total_users: 0,
            total_filled: 0,
            total_watered: 0,
            dev_address: @0xf56d8f1d7fe89e78dfaed9c87cba8a0ee71e669e3694ba3ee6bd1640249f88bf,
            marketing_address: @0x2512bd014646f6e9dfeb20aea5b0a74599b0376fab5ae31a08e5545508dd196e,
            fill_dev_fee_bps: 500,
            fill_marketing_fee_bps: 500,
            water_dev_fee_bps: 300,
            water_marketing_fee_bps: 200,
            tap_dev_fee_bps: 300,
            tap_early_penalty_bps: 5000,
            tap_late_bonus_bps: 500,
            admin_cap: object::id(&admin_cap),
        };
        
        transfer::transfer(admin_cap, tx_context::sender(ctx));
        transfer::share_object(state);
    }

    #[entry]
    public fun create_user_state(state: &mut GlobalState, clock: &Clock, ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);
        let user_state = UserState {
            id: object::new(ctx),
            user: sender,
            filled_amount: 0,
            watered_amount: 0,
            last_fill_time_ms: clock::timestamp_ms(clock),
            last_claim_time_ms: clock::timestamp_ms(clock),
        };
        state.total_users = state.total_users + 1;
        event::emit(UserCreated { user: sender, user_state_id: object::id(&user_state) });
        transfer::transfer(user_state, sender);
    }

    #[entry]
    public fun fill(state: &mut GlobalState, user_state: &mut UserState, amount_coin: Coin<SUI>, clock: &Clock, ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);
        assert!(user_state.user == sender, E_INVALID_ACTION);

        let value = coin::value(&amount_coin);
        assert!(value > 0, E_INSUFFICIENT_FUNDS);

        let dev_fee = value * state.fill_dev_fee_bps / 10000;
        let marketing_fee = value * state.fill_marketing_fee_bps / 10000;
        let rewards_amount = value - dev_fee - marketing_fee;

        transfer::public_transfer(coin::split(&mut amount_coin, dev_fee, ctx), state.dev_address);
        transfer::public_transfer(coin::split(&mut amount_coin, marketing_fee, ctx), state.marketing_address);
        
        balance::join(&mut state.total_rewards, coin::into_balance(amount_coin));
        
        state.total_filled = state.total_filled + rewards_amount;
        user_state.filled_amount = user_state.filled_amount + rewards_amount;
        user_state.last_fill_time_ms = clock::timestamp_ms(clock);

        event::emit(Filled { user: sender, amount_sui: value, net_fill_increase: rewards_amount });
    }

    #[entry]
    public fun water(state: &mut GlobalState, user_state: &mut UserState, amount_coin: Coin<SUI>, ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);
        assert!(user_state.user == sender, E_INVALID_ACTION);

        let value = coin::value(&amount_coin);
        assert!(value > 0, E_INSUFFICIENT_FUNDS);

        let dev_fee = value * state.water_dev_fee_bps / 10000;
        let marketing_fee = value * state.water_marketing_fee_bps / 10000;
        let watered_amount = value - dev_fee - marketing_fee;

        transfer::public_transfer(coin::split(&mut amount_coin, dev_fee, ctx), state.dev_address);
        transfer::public_transfer(coin::split(&mut amount_coin, marketing_fee, ctx), state.marketing_address);
        balance::join(&mut state.total_rewards, coin::into_balance(amount_coin));

        state.total_watered = state.total_watered + watered_amount;
        user_state.watered_amount = user_state.watered_amount + watered_amount;

        event::emit(Watered { user: sender, amount_sui: value, net_water_increase: watered_amount });
    }

    #[entry]
    public fun tap(state: &mut GlobalState, user_state: &mut UserState, clock: &Clock, ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);
        assert!(user_state.user == sender, E_INVALID_ACTION);

        let user_share_numerator = user_state.filled_amount + user_state.watered_amount;
        let total_share_denominator = state.total_filled + state.total_watered;
        
        assert!(total_share_denominator > 0, E_INVALID_ACTION);
        
        let gross_reward = (balance::value(&state.total_rewards) as u128 * user_share_numerator as u128 / total_share_denominator as u128) as u64;
        assert!(gross_reward > 0, E_INSUFFICIENT_FUNDS);

        let dev_fee = gross_reward * state.tap_dev_fee_bps / 10000;
        let reward_after_dev_fee = gross_reward - dev_fee;

        let user_reward;
        let pool_refill;

        let time_since_last_claim = clock::timestamp_ms(clock) - user_state.last_claim_time_ms;

        if (time_since_last_claim >= DAY_MS) {
            pool_refill = reward_after_dev_fee * state.tap_late_bonus_bps / 10000;
            user_reward = reward_after_dev_fee - pool_refill;
        } else {
            pool_refill = reward_after_dev_fee * state.tap_early_penalty_bps / 10000;
            user_reward = reward_after_dev_fee - pool_refill;
        };
        
        assert!(balance::value(&state.total_rewards) >= gross_reward, E_INSUFFICIENT_FUNDS);

        let reward_coin = coin::take(&mut state.total_rewards, gross_reward, ctx);
        
        transfer::public_transfer(coin::split(&mut reward_coin, dev_fee, ctx), state.dev_address);
        balance::join(&mut state.total_rewards, coin::into_balance(coin::split(&mut reward_coin, pool_refill, ctx)));
        transfer::public_transfer(reward_coin, sender);

        user_state.last_claim_time_ms = clock::timestamp_ms(clock);
        
        event::emit(Tapped { 
            user: sender, 
            gross_reward, 
            user_reward, 
            dev_fee, 
            pool_refill 
        });
    }

    #[entry]
    public fun update_fees(
        state: &mut GlobalState, admin_cap: &AdminCap,
        fill_dev_bps: u64, fill_mkt_bps: u64,
        water_dev_bps: u64, water_mkt_bps: u64,
        tap_dev_bps: u64, tap_early_bps: u64, tap_late_bps: u64,
    ) {
        assert!(object::id(admin_cap) == state.admin_cap, E_NOT_ADMIN);
        state.fill_dev_fee_bps = fill_dev_bps;
        state.fill_marketing_fee_bps = fill_mkt_bps;
        state.water_dev_fee_bps = water_dev_bps;
        state.water_marketing_fee_bps = water_mkt_bps;
        state.tap_dev_fee_bps = tap_dev_bps;
        state.tap_early_penalty_bps = tap_early_bps;
        state.tap_late_bonus_bps = tap_late_bps;
    }

    #[entry]
    public fun update_wallets(state: &mut GlobalState, admin_cap: &AdminCap, new_dev: address, new_mkt: address) {
        assert!(object::id(admin_cap) == state.admin_cap, E_NOT_ADMIN);
        state.dev_address = new_dev;
        state.marketing_address = new_mkt;
    }
}
