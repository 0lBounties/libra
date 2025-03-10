address 0x1 {

/// Maintains information about the set of validators used during consensus.
/// Provides functions to add, remove, and update validators in the
/// validator set.
///
/// > Note: When trying to understand this code, it's important to know that "config"
/// and "configuration" are used for several distinct concepts.

/////// 0L /////////
// Error Code file prefix: 1200

module DiemSystem {
    use 0x1::CoreAddresses;
    use 0x1::Errors;
    use 0x1::DiemConfig::{Self, ModifyConfigCapability};
    use 0x1::Option::{Self, Option};
    use 0x1::Signer;
    use 0x1::ValidatorConfig;
    use 0x1::Vector;
    use 0x1::Roles;
    use 0x1::DiemTimestamp;
    //////// 0L ////////
    use 0x1::FixedPoint32;
    use 0x1::Stats;
    use 0x1::Cases;
    use 0x1::NodeWeight;

    // use 0x1::Debug::print;

    /// Information about a Validator Owner.
    struct ValidatorInfo has copy, drop, store {
        /// The address (account) of the Validator Owner
        addr: address,
        /// The voting power of the Validator Owner (currently always 1).
        consensus_voting_power: u64,
        /// Configuration information about the Validator, such as the
        /// Validator Operator, human name, and info such as consensus key
        /// and network addresses.
        config: ValidatorConfig::Config,
        /// The time of last reconfiguration invoked by this validator
        /// in microseconds
        last_config_update_time: u64,
    }

    /// Enables a scheme that restricts the DiemSystem config
    /// in DiemConfig from being modified by any other module.  Only
    /// code in this module can get a reference to the ModifyConfigCapability<DiemSystem>,
    /// which is required by `DiemConfig::set_with_capability_and_reconfigure` to
    /// modify the DiemSystem config. This is only needed by `update_config_and_reconfigure`.
    /// Only Diem root can add or remove a validator from the validator set, so the
    /// capability is not needed for access control in those functions.
    struct CapabilityHolder has key {
        /// Holds a capability returned by `DiemConfig::publish_new_config_and_get_capability`
        /// which is called in `initialize_validator_set`.
        cap: ModifyConfigCapability<DiemSystem>,
    }

    /// The DiemSystem struct stores the validator set and crypto scheme in
    /// DiemConfig. The DiemSystem struct is stored by DiemConfig, which publishes a
    /// DiemConfig<DiemSystem> resource.
    struct DiemSystem has copy, drop, store {
        /// The current consensus crypto scheme.
        scheme: u8,
        /// The current validator set.
        validators: vector<ValidatorInfo>,
    }
    spec DiemSystem {
        /// Members of `validators` vector (the validator set) have unique addresses.
        invariant
            forall i in 0..len(validators), j in 0..len(validators):
                validators[i].addr == validators[j].addr ==> i == j;
    }

    /// The `CapabilityHolder` resource was not in the required state
    const ECAPABILITY_HOLDER: u64 = 12000; /////// 0L /////////
    /// Tried to add a validator with an invalid state to the validator set
    const EINVALID_PROSPECTIVE_VALIDATOR: u64 = 12001; /////// 0L /////////
    /// Tried to add a validator to the validator set that was already in it
    const EALREADY_A_VALIDATOR: u64 = 12002; /////// 0L /////////
    /// An operation was attempted on an address not in the vaidator set
    const ENOT_AN_ACTIVE_VALIDATOR: u64 = 12003; /////// 0L /////////
    /// The validator operator is not the operator for the specified validator
    const EINVALID_TRANSACTION_SENDER: u64 = 12004; /////// 0L /////////
    /// An out of bounds index for the validator set was encountered
    const EVALIDATOR_INDEX: u64 = 12005; /////// 0L /////////
    /// Rate limited when trying to update config
    const ECONFIG_UPDATE_RATE_LIMITED: u64 = 12006; /////// 0L /////////
    /// Validator set already at maximum allowed size
    const EMAX_VALIDATORS: u64 = 12007; /////// 0L /////////

    /// Number of microseconds in 5 minutes
    const FIVE_MINUTES: u64 = 300000000;

    /// The maximum number of allowed validators in the validator set
    const MAX_VALIDATORS: u64 = 256;

    ///////////////////////////////////////////////////////////////////////////
    // Setup methods
    ///////////////////////////////////////////////////////////////////////////


    /// Publishes the DiemConfig for the DiemSystem struct, which contains the current
    /// validator set. Also publishes the `CapabilityHolder` with the
    /// ModifyConfigCapability<DiemSystem> returned by the publish function, which allows
    /// code in this module to change DiemSystem config (including the validator set).
    /// Must be invoked by the Diem root a single time in Genesis.
    public fun initialize_validator_set(
        dr_account: &signer,
    ) {
        DiemTimestamp::assert_genesis();
        Roles::assert_diem_root(dr_account);

        let cap = DiemConfig::publish_new_config_and_get_capability<DiemSystem>(
            dr_account,
            DiemSystem {
                scheme: 0,
                validators: Vector::empty(),
            },
        );
        assert(
            !exists<CapabilityHolder>(CoreAddresses::DIEM_ROOT_ADDRESS()),
            Errors::already_published(ECAPABILITY_HOLDER)
        );
        move_to(dr_account, CapabilityHolder { cap })
    }
    spec initialize_validator_set {
        modifies global<DiemConfig::DiemConfig<DiemSystem>>(CoreAddresses::DIEM_ROOT_ADDRESS());
        include DiemTimestamp::AbortsIfNotGenesis;
        include Roles::AbortsIfNotDiemRoot{account: dr_account};
        let dr_addr = Signer::spec_address_of(dr_account);
        // TODO: The next two aborts_if's are not independent. Perhaps they can be
        // simplified.
        aborts_if DiemConfig::spec_is_published<DiemSystem>() with Errors::ALREADY_PUBLISHED;
        aborts_if exists<CapabilityHolder>(dr_addr) with Errors::ALREADY_PUBLISHED;
        ensures exists<CapabilityHolder>(dr_addr);
        ensures DiemConfig::spec_is_published<DiemSystem>();
        ensures len(spec_get_validators()) == 0;
    }

    /// Copies a DiemSystem struct into the DiemConfig<DiemSystem> resource
    /// Called by the add, remove, and update functions.
    fun set_diem_system_config(value: DiemSystem) acquires CapabilityHolder {
        DiemTimestamp::assert_operating();
        assert(
            exists<CapabilityHolder>(CoreAddresses::DIEM_ROOT_ADDRESS()),
            Errors::not_published(ECAPABILITY_HOLDER)
        );
        // Updates the DiemConfig<DiemSystem> and emits a reconfigure event.
        DiemConfig::set_with_capability_and_reconfigure<DiemSystem>(
            &borrow_global<CapabilityHolder>(CoreAddresses::DIEM_ROOT_ADDRESS()).cap,
            value
        )
    }
    spec set_diem_system_config {
        pragma opaque;
        modifies global<DiemConfig::DiemConfig<DiemSystem>>(CoreAddresses::DIEM_ROOT_ADDRESS());
        modifies global<DiemConfig::Configuration>(CoreAddresses::DIEM_ROOT_ADDRESS());
        include DiemTimestamp::AbortsIfNotOperating;
        include DiemConfig::ReconfigureAbortsIf;
        /// `payload` is the only field of DiemConfig, so next completely specifies it.
        ensures global<DiemConfig::DiemConfig<DiemSystem>>(CoreAddresses::DIEM_ROOT_ADDRESS()).payload == value;
        include DiemConfig::ReconfigureEmits;
    }

    ///////////////////////////////////////////////////////////////////////////
    // Methods operating the Validator Set config callable by the diem root account
    ///////////////////////////////////////////////////////////////////////////

    /// Adds a new validator to the validator set.
    public fun add_validator(
        dr_account: &signer,
        validator_addr: address
    ) acquires CapabilityHolder {

        DiemTimestamp::assert_operating();
        Roles::assert_diem_root(dr_account);
        // A prospective validator must have a validator config resource
        assert(ValidatorConfig::is_valid(validator_addr), Errors::invalid_argument(EINVALID_PROSPECTIVE_VALIDATOR));

        // Bound the validator set size
        assert(
            validator_set_size() < MAX_VALIDATORS,
            Errors::limit_exceeded(EMAX_VALIDATORS)
        );

        let diem_system_config = get_diem_system_config();

        // Ensure that this address is not already a validator
        assert(
            !is_validator_(validator_addr, &diem_system_config.validators),
            Errors::invalid_argument(EALREADY_A_VALIDATOR)
        );

        // it is guaranteed that the config is non-empty
        let config = ValidatorConfig::get_config(validator_addr);
        Vector::push_back(&mut diem_system_config.validators, ValidatorInfo {
            addr: validator_addr,
            config, // copy the config over to ValidatorSet
            consensus_voting_power: 1,
            last_config_update_time: DiemTimestamp::now_microseconds(),
        });

        set_diem_system_config(diem_system_config);
    }
    spec add_validator {
        modifies global<DiemConfig::DiemConfig<DiemSystem>>(CoreAddresses::DIEM_ROOT_ADDRESS());
        include AddValidatorAbortsIf;
        include AddValidatorEnsures;
        include DiemConfig::ReconfigureEmits;
    }
    spec schema AddValidatorAbortsIf {
        dr_account: signer;
        validator_addr: address;
        aborts_if validator_set_size() >= MAX_VALIDATORS with Errors::LIMIT_EXCEEDED;
        include DiemTimestamp::AbortsIfNotOperating;
        include Roles::AbortsIfNotDiemRoot{account: dr_account};
        include DiemConfig::ReconfigureAbortsIf;
        aborts_if !ValidatorConfig::is_valid(validator_addr) with Errors::INVALID_ARGUMENT;
        aborts_if spec_is_validator(validator_addr) with Errors::INVALID_ARGUMENT;
    }
    spec schema AddValidatorEnsures {
        validator_addr: address;
        /// DIP-6 property: validator has validator role. The code does not check this explicitly,
        /// but it is implied by the `assert ValidatorConfig::is_valid`, since there
        /// is an invariant (in ValidatorConfig) that a an address with a published ValidatorConfig has
        /// a ValidatorRole
        ensures Roles::spec_has_validator_role_addr(validator_addr);
        ensures ValidatorConfig::is_valid(validator_addr);
        ensures spec_is_validator(validator_addr);
        let vs = spec_get_validators();
        let post post_vs = spec_get_validators();
        ensures Vector::eq_push_back(post_vs,
                                     vs,
                                     ValidatorInfo {
                                         addr: validator_addr,
                                         config: ValidatorConfig::spec_get_config(validator_addr),
                                         consensus_voting_power: 1,
                                         last_config_update_time: DiemTimestamp::spec_now_microseconds(),
                                      }
                                   );
    }


    /// Removes a validator, aborts unless called by diem root account
    public fun remove_validator(
        dr_account: &signer,
        validator_addr: address
    ) acquires CapabilityHolder {
        DiemTimestamp::assert_operating();
        Roles::assert_diem_root(dr_account);
        let diem_system_config = get_diem_system_config();
        // Ensure that this address is an active validator
        let to_remove_index_vec = get_validator_index_(&diem_system_config.validators, validator_addr);
        assert(Option::is_some(&to_remove_index_vec), Errors::invalid_argument(ENOT_AN_ACTIVE_VALIDATOR));
        let to_remove_index = *Option::borrow(&to_remove_index_vec);
        // Remove corresponding ValidatorInfo from the validator set
        _  = Vector::swap_remove(&mut diem_system_config.validators, to_remove_index);

        set_diem_system_config(diem_system_config);
    }
    spec remove_validator {
        modifies global<DiemConfig::DiemConfig<DiemSystem>>(CoreAddresses::DIEM_ROOT_ADDRESS());
        include RemoveValidatorAbortsIf;
        include RemoveValidatorEnsures;
        include DiemConfig::ReconfigureEmits;
    }
    spec schema RemoveValidatorAbortsIf {
        dr_account: signer;
        validator_addr: address;
        include Roles::AbortsIfNotDiemRoot{account: dr_account};
        include DiemTimestamp::AbortsIfNotOperating;
        include DiemConfig::ReconfigureAbortsIf;
        aborts_if !spec_is_validator(validator_addr) with Errors::INVALID_ARGUMENT;
    }
    spec schema RemoveValidatorEnsures {
        validator_addr: address;
        let vs = spec_get_validators();
        let post post_vs = spec_get_validators();
        ensures forall vi in post_vs where vi.addr != validator_addr: exists ovi in vs: vi == ovi;
        /// Removed validator is no longer a validator.  Depends on no other entries for same address
        /// in validator_set
        ensures !spec_is_validator(validator_addr);
    }

    /// Copy the information from ValidatorConfig into the validator set.
    /// This function makes no changes to the size or the members of the set.
    /// If the config in the ValidatorSet changes, it stores the new DiemSystem
    /// and emits a reconfigurationevent.
    public fun update_config_and_reconfigure(
        validator_operator_account: &signer,
        validator_addr: address,
    ) acquires CapabilityHolder {
        DiemTimestamp::assert_operating();
        Roles::assert_validator_operator(validator_operator_account);
        assert(
            ValidatorConfig::get_operator(validator_addr) == Signer::address_of(validator_operator_account),
            Errors::invalid_argument(EINVALID_TRANSACTION_SENDER)
        );
        let diem_system_config = get_diem_system_config();
        let to_update_index_vec = get_validator_index_(&diem_system_config.validators, validator_addr);
        assert(Option::is_some(&to_update_index_vec), Errors::invalid_argument(ENOT_AN_ACTIVE_VALIDATOR));
        let to_update_index = *Option::borrow(&to_update_index_vec);
        let is_validator_info_updated = update_ith_validator_info_(&mut diem_system_config.validators, to_update_index);
        if (is_validator_info_updated) {
            let validator_info = Vector::borrow_mut(&mut diem_system_config.validators, to_update_index);
            assert(DiemTimestamp::now_microseconds() >
                   validator_info.last_config_update_time + FIVE_MINUTES,
                   ECONFIG_UPDATE_RATE_LIMITED);
            validator_info.last_config_update_time = DiemTimestamp::now_microseconds();
            set_diem_system_config(diem_system_config);
        }
    }
    spec update_config_and_reconfigure {
        pragma opaque;
        // TODO(timeout): this started timing out after recent refactoring. Investigate.
        pragma verify = false;
        modifies global<DiemConfig::Configuration>(CoreAddresses::DIEM_ROOT_ADDRESS());
        modifies global<DiemConfig::DiemConfig<DiemSystem>>(CoreAddresses::DIEM_ROOT_ADDRESS());
        include ValidatorConfig::AbortsIfGetOperator{addr: validator_addr};
        include UpdateConfigAndReconfigureAbortsIf;
        include UpdateConfigAndReconfigureEnsures;
        // The property below is not in `UpdateConfigAndReconfigureEnsures` because that is reused
        // with a different condition in the transaction script `set_validator_config_and_reconfigure`.
        // The validator set is not updated if: (1) `validator_addr` is not in the validator set, or
        // (2) the validator info would not change. The code only does a reconfiguration if the
        // validator set would change.  `ReconfigureAbortsIf` complains if the block time does not
        // advance, but block time only advances if there is a reconfiguration.
        let is_validator_info_updated =
            ValidatorConfig::is_valid(validator_addr) &&
            (exists v_info in spec_get_validators():
                v_info.addr == validator_addr
                && v_info.config != ValidatorConfig::spec_get_config(validator_addr));
        include is_validator_info_updated ==> DiemConfig::ReconfigureAbortsIf;
        include UpdateConfigAndReconfigureEmits;
    }
    spec schema UpdateConfigAndReconfigureAbortsIf {
        validator_addr: address;
        validator_operator_account: signer;
        let validator_operator_addr = Signer::address_of(validator_operator_account);
        include DiemTimestamp::AbortsIfNotOperating;
        /// Must abort if the signer does not have the ValidatorOperator role [[H15]][PERMISSION].
        include Roles::AbortsIfNotValidatorOperator{validator_operator_addr: validator_operator_addr};
        include ValidatorConfig::AbortsIfNoValidatorConfig{addr: validator_addr};
        aborts_if ValidatorConfig::get_operator(validator_addr) != validator_operator_addr
            with Errors::INVALID_ARGUMENT;
        aborts_if !spec_is_validator(validator_addr) with Errors::INVALID_ARGUMENT;
    }
    /// Does not change the length of the validator set, only changes ValidatorInfo
    /// for validator_addr, and doesn't change any addresses.
    spec schema UpdateConfigAndReconfigureEnsures {
        validator_addr: address;
        let vs = spec_get_validators();
        let post post_vs = spec_get_validators();
        ensures len(post_vs) == len(vs);
        /// No addresses change in the validator set
        ensures forall i in 0..len(vs): post_vs[i].addr == vs[i].addr;
        /// If the `ValidatorInfo` address is not the one we're changing, the info does not change.
        ensures forall i in 0..len(vs) where vs[i].addr != validator_addr:
                         post_vs[i] == vs[i];
        /// It updates the correct entry in the correct way
        ensures forall i in 0..len(vs): post_vs[i].config == vs[i].config ||
                    (vs[i].addr == validator_addr &&
                     post_vs[i].config == ValidatorConfig::get_config(validator_addr));
        /// DIP-6 property
        ensures Roles::spec_has_validator_role_addr(validator_addr);
    }
    spec schema UpdateConfigAndReconfigureEmits {
        validator_addr: address;
        let is_validator_info_updated =
            ValidatorConfig::is_valid(validator_addr) &&
            (exists v_info in spec_get_validators():
                v_info.addr == validator_addr
                && v_info.config != ValidatorConfig::spec_get_config(validator_addr));
        include is_validator_info_updated ==> DiemConfig::ReconfigureEmits;
    }

    ///////////////////////////////////////////////////////////////////////////
    // Publicly callable APIs: getters
    ///////////////////////////////////////////////////////////////////////////

    /// Get the DiemSystem configuration from DiemConfig
    public fun get_diem_system_config(): DiemSystem {
        DiemConfig::get<DiemSystem>()
    }
    spec get_diem_system_config {
        pragma opaque;
        include DiemConfig::AbortsIfNotPublished<DiemSystem>;
        ensures result == DiemConfig::get<DiemSystem>();
    }

    /// Return true if `addr` is in the current validator set
    public fun is_validator(addr: address): bool {
        is_validator_(addr, &get_diem_system_config().validators)
    }
    spec is_validator {
        pragma opaque;
        // TODO: Publication of DiemConfig<DiemSystem> in initialization
        // and persistence of configs implies that the next abort cannot
        // actually happen.
        include DiemConfig::AbortsIfNotPublished<DiemSystem>;
        ensures result == spec_is_validator(addr);
    }
    spec fun spec_is_validator(addr: address): bool {
        exists v in spec_get_validators(): v.addr == addr
    }

    /// Returns validator config. Aborts if `addr` is not in the validator set.
    public fun get_validator_config(addr: address): ValidatorConfig::Config {
        let diem_system_config = get_diem_system_config();
        let validator_index_vec = get_validator_index_(&diem_system_config.validators, addr);
        assert(Option::is_some(&validator_index_vec), Errors::invalid_argument(ENOT_AN_ACTIVE_VALIDATOR));
        *&(Vector::borrow(&diem_system_config.validators, *Option::borrow(&validator_index_vec))).config
    }
    spec get_validator_config {
        pragma opaque;
        include DiemConfig::AbortsIfNotPublished<DiemSystem>;
        aborts_if !spec_is_validator(addr) with Errors::INVALID_ARGUMENT;
        ensures
            exists info in DiemConfig::get<DiemSystem>().validators where info.addr == addr:
                result == info.config;
    }

    /// Return the size of the current validator set
    public fun validator_set_size(): u64 {
        Vector::length(&get_diem_system_config().validators)
    }
    spec validator_set_size {
        pragma opaque;
        include DiemConfig::AbortsIfNotPublished<DiemSystem>;
        ensures result == len(spec_get_validators());
    }

    /// Get the `i`'th validator address in the validator set.
    public fun get_ith_validator_address(i: u64): address {
        assert(i < validator_set_size(), Errors::invalid_argument(EVALIDATOR_INDEX));
        Vector::borrow(&get_diem_system_config().validators, i).addr
    }
    spec get_ith_validator_address {
        pragma opaque;
        include DiemConfig::AbortsIfNotPublished<DiemSystem>;
        aborts_if i >= len(spec_get_validators()) with Errors::INVALID_ARGUMENT;
        ensures result == spec_get_validators()[i].addr;
    }

    ///////////////////////////////////////////////////////////////////////////
    // Private functions
    ///////////////////////////////////////////////////////////////////////////

    /// Get the index of the validator by address in the `validators` vector
    /// It has a loop, so there are spec blocks in the code to assert loop invariants.
    fun get_validator_index_(validators: &vector<ValidatorInfo>, addr: address): Option<u64> {
        let size = Vector::length(validators);
        let i = 0;
        while ({
            spec {
                assert i <= size;
                assert forall j in 0..i: validators[j].addr != addr;
            };
            (i < size)
        })
        {
            let validator_info_ref = Vector::borrow(validators, i);
            if (validator_info_ref.addr == addr) {
                spec {
                    assert validators[i].addr == addr;
                };
                return Option::some(i)
            };
            i = i + 1;
        };
        spec {
            assert i == size;
            assert forall j in 0..size: validators[j].addr != addr;
        };
        return Option::none()
    }
    spec get_validator_index_ {
        pragma opaque;
        aborts_if false;
        let size = len(validators);
        /// If `addr` is not in validator set, returns none.
        ensures (forall i in 0..size: validators[i].addr != addr) ==> Option::is_none(result);
        /// If `addr` is in validator set, return the least index of an entry with that address.
        /// The data invariant associated with the DiemSystem.validators that implies
        /// that there is exactly one such address.
        ensures
            (exists i in 0..size: validators[i].addr == addr) ==>
                Option::is_some(result)
                && {
                        let at = Option::borrow(result);
                        0 <= at && at < size && validators[at].addr == addr
                    };
    }

    /// Updates *i*th validator info, if nothing changed, return false.
    /// This function never aborts.
    fun update_ith_validator_info_(validators: &mut vector<ValidatorInfo>, i: u64): bool {
        let size = Vector::length(validators);
        // This provably cannot happen, but left it here for safety.
        if (i >= size) {
            return false
        };
        let validator_info = Vector::borrow_mut(validators, i);
        // "is_valid" below should always hold based on a global invariant later
        // in the file (which proves if we comment out some other specifications),
        // but it is left here for safety.
        if (!ValidatorConfig::is_valid(validator_info.addr)) {
            return false
        };
        let new_validator_config = ValidatorConfig::get_config(validator_info.addr);
        // check if information is the same
        let config_ref = &mut validator_info.config;
        if (config_ref == &new_validator_config) {
            return false
        };
        *config_ref = new_validator_config;
        true
    }
    spec update_ith_validator_info_ {
        pragma opaque;
        aborts_if false;
        let new_validator_config = ValidatorConfig::spec_get_config(validators[i].addr);
        /// Prover is able to prove this because get_validator_index_ ensures it
        /// in calling context.
        requires 0 <= i && i < len(validators);
        /// Somewhat simplified from the code because of properties guaranteed
        /// by the calling context.
        ensures
            result ==
                (ValidatorConfig::is_valid(validators[i].addr) &&
                 new_validator_config != old(validators[i].config));
        /// It only updates validators at index `i`, and updates the
        /// `config` field to `new_validator_config`.
        ensures
            result ==>
                validators == update(
                    old(validators),
                    i,
                    update_field(old(validators[i]), config, new_validator_config)
                );
        /// Does not change validators if result is false
        ensures !result ==> validators == old(validators);
        /// Updates the ith validator entry (and nothing else), as appropriate.
        ensures validators == update(old(validators), i, validators[i]);
        /// Needed these assertions to make "consensus voting power is always 1" invariant
        /// prove (not sure why).
        requires forall i1 in 0..len(spec_get_validators()):
           spec_get_validators()[i1].consensus_voting_power == 1;
        ensures forall i1 in 0..len(spec_get_validators()):
           spec_get_validators()[i1].consensus_voting_power == 1;
    }

    /// Private function checks for membership of `addr` in validator set.
    fun is_validator_(addr: address, validators_vec_ref: &vector<ValidatorInfo>): bool {
        Option::is_some(&get_validator_index_(validators_vec_ref, addr))
    }
    spec is_validator_ {
        pragma opaque;
        aborts_if false;
        ensures result == (exists v in validators_vec_ref: v.addr == addr);
    }

    // =================================================================
    // Module Specification

    spec module {} // Switch to module documentation context

    /// # Initialization
    spec module {
        /// After genesis, the `DiemSystem` configuration is published, as well as the capability
        /// which grants the right to modify it to certain functions in this module.
        invariant DiemTimestamp::is_operating() ==>
            DiemConfig::spec_is_published<DiemSystem>() &&
            exists<CapabilityHolder>(CoreAddresses::DIEM_ROOT_ADDRESS());
    }

    /// # Access Control

    /// Access control requirements for validator set are a bit more complicated than
    /// many parts of the framework because of `update_config_and_reconfigure`.
    /// That function updates the validator info (e.g., the network address) for a
    /// particular Validator Owner, but only if the signer is the Operator for that owner.
    /// Therefore, we must ensure that the information for other validators in the
    /// validator set are not changed, which is specified locally for
    /// `update_config_and_reconfigure`.

    spec module {
       /// The permission "{Add, Remove} Validator" is granted to DiemRoot [[H14]][PERMISSION].
       apply Roles::AbortsIfNotDiemRoot{account: dr_account} to add_validator, remove_validator;
    }

    spec schema ValidatorSetConfigRemainsSame {
        ensures spec_get_validators() == old(spec_get_validators());
    }
    spec module {
        /// Only {add, remove} validator [[H14]][PERMISSION] and update_config_and_reconfigure
        /// [[H15]][PERMISSION] may change the set of validators in the configuration.
        /// `set_diem_system_config` is a private function which is only called by other
        /// functions in the "except" list. `initialize_validator_set` is only called in
        /// Genesis.
        apply ValidatorSetConfigRemainsSame to *, *<T>
           except add_validator, remove_validator, update_config_and_reconfigure,
               initialize_validator_set, set_diem_system_config;
    }

    /// # Helper Functions

    /// Fetches the currently published validator set from the published DiemConfig<DiemSystem>
    /// resource.
    spec fun spec_get_validators(): vector<ValidatorInfo> {
        DiemConfig::get<DiemSystem>().validators
    }

    spec module {

       /// Every validator has a published ValidatorConfig whose config option is "some"
       /// (meaning of ValidatorConfig::is_valid).
       /// > Unfortunately, this times out for unknown reasons (it doesn't seem to be hard),
       /// so it is deactivated.
       /// The Prover can prove it if the uniqueness invariant for the DiemSystem resource
       /// is commented out, along with aborts for update_config_and_reconfigure and everything
       /// else that breaks (e.g., there is an ensures in remove_validator that has to be
       /// commented out)
       invariant [deactivated, global] forall i1 in 0..len(spec_get_validators()):
           ValidatorConfig::is_valid(spec_get_validators()[i1].addr);

       /// Every validator in the validator set has a validator role.
       /// > Note: Verification of DiemSystem seems to be very sensitive, and will
       /// often time out after small changes.  Disabling this property
       /// (with [deactivate, global]) is sometimes a quick temporary fix.
       invariant forall i1 in 0..len(spec_get_validators()):
           Roles::spec_has_validator_role_addr(spec_get_validators()[i1].addr);

       /// `Consensus_voting_power` is always 1. In future implementations, this
       /// field may have different values in which case this property will have to
       /// change. It's here currently because and accidental or illicit change
       /// to the voting power of a validator could defeat the Byzantine fault tolerance
       /// of DiemBFT.
       invariant forall i1 in 0..len(spec_get_validators()):
           spec_get_validators()[i1].consensus_voting_power == 1;

    }

    ///////// 0L //////////
    // This function takes in a set of top n validators and updates the validator set.
    // NewEpochEvent event will be fired.
    // The Association, the VM, the validator operator or the validator from the current validator set
    // are authorized to update the set of validator infos and add/remove validators
    // Tests for this method are written in move-lang/functional-tests/0L/reconfiguration/bulk_update.move

    // TODO: Has this been superceded by update_config_and_reconfigure ?
    // Function code:01
    public fun bulk_update_validators(
        account: &signer,
        new_validators: vector<address>
    ) acquires CapabilityHolder {
        DiemTimestamp::assert_operating();
        assert(Signer::address_of(account) == CoreAddresses::DIEM_ROOT_ADDRESS(), Errors::requires_role(120001));

        // Either check for each validator and add/remove them or clear the current list and append the list.
        // The first way might be computationally expensive, so I choose to go with second approach.

        // Clear all the current validators  ==> Intialize new validators
        let next_epoch_validators = Vector::empty();

        let n = Vector::length<address>(&new_validators);
        // Get the current validator and append it to list
        let index = 0;
        while (index < n) {
            let account_address = *(Vector::borrow<address>(&new_validators, index));

            // A prospective validator must have a validator config resource
            assert(ValidatorConfig::is_valid(account_address), Errors::invalid_argument(EINVALID_PROSPECTIVE_VALIDATOR));
                        
            if (!is_validator(account_address)) {
                add_validator(account, account_address);
            };
            
            let config = ValidatorConfig::get_config(account_address);
            Vector::push_back(&mut next_epoch_validators, ValidatorInfo {
                addr: account_address,
                config, // copy the config over to ValidatorSet
                consensus_voting_power: 1 + NodeWeight::proof_of_weight(account_address),
                last_config_update_time: DiemTimestamp::now_microseconds(),
            });

            // NOTE: This was move to redeem. Update the ValidatorUniverse.mining_epoch_count with +1 at the end of the epoch.
            // ValidatorUniverse::update_validator_epoch_count(account_address);
            index = index + 1;
        };

        let next_count = Vector::length<ValidatorInfo>(&next_epoch_validators);
        assert(next_count > 0, Errors::invalid_argument(120001) );
        // Transaction::assert(next_count > n, 90000000002 );
        assert(next_count == n, Errors::invalid_argument(1200011) );

        // We have vector of validators - updated!
        // Next, let us get the current validator set for the current parameters
        let outgoing_validator_set = get_diem_system_config();

        // We create a new Validator set using scheme from outgoingValidatorset and update the validator set.
        let updated_validator_set = DiemSystem {
            scheme: outgoing_validator_set.scheme,
            validators: next_epoch_validators,
        };

        // Updated the configuration using updated validator set. Now, start new epoch
        set_diem_system_config(updated_validator_set);
    }

    /////// 0L /////////
    //get_compliant_val_votes
    //Function code:02
    public fun get_fee_ratio(vm: &signer, height_start: u64, height_end: u64): (vector<address>, vector<FixedPoint32::FixedPoint32>) {

        let validators = &get_diem_system_config().validators;

        let compliant_nodes = Vector::empty<address>();
        let count_compliant_votes = 0;
        let i = 0;

        while (i < Vector::length(validators)) {

            let addr = Vector::borrow(validators, i).addr;

            let case = Cases::get_case(vm, addr, height_start, height_end);
            if (case == 1) {
                let node_votes = Stats::node_current_votes(vm, addr);
                Vector::push_back(&mut compliant_nodes, addr);
                count_compliant_votes = count_compliant_votes + node_votes;
            };

            i = i + 1;

        };

        // calculate the ratio of votes per node.
        let fee_ratios = Vector::empty<FixedPoint32::FixedPoint32>();
        let k = 0;
        while (k < Vector::length(&compliant_nodes)) {

            let addr = *Vector::borrow(&compliant_nodes, k);
            let node_votes = Stats::node_current_votes(vm, addr);
            let ratio = FixedPoint32::create_from_rational(node_votes, count_compliant_votes);
            Vector::push_back(&mut fee_ratios, ratio);
             k = k + 1;

        };

        if (Vector::length(&compliant_nodes) != Vector::length(&fee_ratios)) return (Vector::empty(), Vector::empty());

        (compliant_nodes, fee_ratios)
    }

    /////// 0L /////////
    public fun get_jailed_set(vm: &signer, height_start: u64, height_end: u64): vector<address> {
      let validator_set = get_val_set_addr();
      let jailed_set = Vector::empty<address>();
      let k = 0;
      while(k < Vector::length(&validator_set)){
        let addr = *Vector::borrow<address>(&validator_set, k);

        // consensus case 1 and 2, allow inclusion into the next validator set.
        let case = Cases::get_case(vm, addr, height_start, height_end);
        if (case == 3 || case == 4){
          Vector::push_back<address>(&mut jailed_set, addr)
        };
        k = k + 1;
      };
      jailed_set
    }

    /////// 0L /////////
    public fun get_val_set_addr(): vector<address> {
        let validators = &get_diem_system_config().validators;
        let nodes = Vector::empty<address>();
        let i = 0;
        while (i < Vector::length(validators)) {
            Vector::push_back(&mut nodes, Vector::borrow(validators, i).addr);
            i = i + 1;
        };
        nodes 
    }

}
}
