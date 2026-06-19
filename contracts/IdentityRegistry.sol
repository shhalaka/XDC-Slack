// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract IdentityRegistry {
    error NameAlreadyRegistered(string name);
    error NameNotRegistered(string name);
    error NotOwner(string name);
    error InvalidName(string name);
    error NameTooShort();
    error NameTooLong();
    error InsufficientFee();
    error NotRegistrar();
    error ZeroAddress();

    event NameRegistered(
        string indexed name,
        bytes32 indexed nameHash,
        address indexed owner,
        uint256 timestamp
    );

    event NameTransferred(
        string indexed name,
        bytes32 indexed nameHash,
        address indexed previousOwner,
        address newOwner,
        uint256 timestamp
    );

    event NameRevoked(
        string indexed name,
        bytes32 indexed nameHash,
        uint256 timestamp
    );

    event RegistrarSet(address indexed oldRegistrar, address indexed newRegistrar);

    uint256 public constant MIN_NAME_LENGTH = 3;
    uint256 public constant MAX_NAME_LENGTH = 32;
    uint256 public constant REGISTRATION_FEE = 0.01 ether;

    mapping(bytes32 => address) private _owners;
    mapping(address => bytes32) private _reverseRegistry;
    mapping(bytes32 => uint256) private _registrationTimestamps;
    mapping(bytes32 => string) private _names;

    address public immutable contractOwner;
    address public registrar;

    constructor() {
        contractOwner = msg.sender;
        registrar = msg.sender;
    }

    modifier onlyNameOwner(string calldata name) {
        bytes32 nameHash = _nameHash(name);
        if (_owners[nameHash] != msg.sender) revert NotOwner(name);
        _;
    }

    modifier onlyRegistrar() {
        if (msg.sender != registrar) revert NotRegistrar();
        _;
    }

    modifier onlyNameOwnerOrRegistrar(string calldata name) {
        bytes32 nameHash = _nameHash(name);
        if (_owners[nameHash] != msg.sender && msg.sender != registrar) {
            revert NotOwner(name);
        }
        _;
    }

    modifier validName(string calldata name) {
        bytes memory nameBytes = bytes(name);
        if (nameBytes.length < MIN_NAME_LENGTH) revert NameTooShort();
        if (nameBytes.length > MAX_NAME_LENGTH) revert NameTooLong();
        _;
    }

    function setRegistrar(address newRegistrar) external {
        if (msg.sender != contractOwner) revert NotRegistrar();
        if (newRegistrar == address(0)) revert ZeroAddress();
        emit RegistrarSet(registrar, newRegistrar);
        registrar = newRegistrar;
    }

    function register(string calldata name)
        external
        payable
        validName(name)
        returns (bool)
    {
        bytes32 nameHash = _nameHash(name);
        if (_owners[nameHash] != address(0)) revert NameAlreadyRegistered(name);

        _owners[nameHash] = msg.sender;
        _reverseRegistry[msg.sender] = nameHash;
        _registrationTimestamps[nameHash] = block.timestamp;
        _names[nameHash] = name;

        emit NameRegistered(name, nameHash, msg.sender, block.timestamp);
        return true;
    }

    function registerByRegistrar(string calldata name, address owner)
        external
        onlyRegistrar
        validName(name)
        returns (bool)
    {
        bytes32 nameHash = _nameHash(name);
        if (_owners[nameHash] != address(0)) revert NameAlreadyRegistered(name);
        if (owner == address(0)) revert ZeroAddress();

        _owners[nameHash] = owner;
        _reverseRegistry[owner] = nameHash;
        _registrationTimestamps[nameHash] = block.timestamp;
        _names[nameHash] = name;

        emit NameRegistered(name, nameHash, owner, block.timestamp);
        return true;
    }

    function transfer(string calldata name, address newOwner)
        external
        onlyNameOwnerOrRegistrar(name)
    {
        if (newOwner == address(0)) revert ZeroAddress();

        bytes32 nameHash = _nameHash(name);
        address previousOwner = _owners[nameHash];

        if (_reverseRegistry[previousOwner] == nameHash) {
            delete _reverseRegistry[previousOwner];
        }

        _owners[nameHash] = newOwner;
        _reverseRegistry[newOwner] = nameHash;

        emit NameTransferred(name, nameHash, previousOwner, newOwner, block.timestamp);
    }

    function revoke(string calldata name) external onlyNameOwner(name) {
        bytes32 nameHash = _nameHash(name);
        address owner = _owners[nameHash];

        delete _owners[nameHash];
        delete _reverseRegistry[owner];
        delete _registrationTimestamps[nameHash];
        delete _names[nameHash];

        emit NameRevoked(name, nameHash, block.timestamp);
    }

    function resolve(string calldata name) external view returns (address) {
        bytes32 nameHash = _nameHash(name);
        return _owners[nameHash];
    }

    function resolve(bytes32 nameHash) external view returns (address) {
        return _owners[nameHash];
    }

    function reverseResolve(address addr) external view returns (string memory) {
        bytes32 nameHash = _reverseRegistry[addr];
        if (nameHash == bytes32(0)) return '';
        return _names[nameHash];
    }

    function isRegistered(string calldata name) external view returns (bool) {
        return _owners[_nameHash(name)] != address(0);
    }

    function isRegistered(bytes32 nameHash) external view returns (bool) {
        return _owners[nameHash] != address(0);
    }

    function registrationTimestamp(string calldata name)
        external
        view
        returns (uint256)
    {
        return _registrationTimestamps[_nameHash(name)];
    }

    function ownerOfName(string calldata name) external view returns (address) {
        return _owners[_nameHash(name)];
    }

    function ownerOfName(bytes32 nameHash) external view returns (address) {
        return _owners[nameHash];
    }

    function withdrawFees() external {
        if (msg.sender != contractOwner) revert NotRegistrar();
        payable(contractOwner).transfer(address(this).balance);
    }

    function _nameHash(string calldata name) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(name));
    }

    receive() external payable {}
}
