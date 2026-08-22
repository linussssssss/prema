// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EvidenceRegistry (Phase 0 stub)
/// @notice Phase 3 target: anchor evidence-bundle hashes, decision hashes, and
///         daily audit-log heads on Base. Append-only by construction; no
///         funds, no tokens, no market logic — ever (see docs/PLAN.md
///         non-negotiables).
/// @dev    Deliberately not deployed and not in CI during Phase 0.
contract EvidenceRegistry {
    event Anchored(bytes32 indexed kind, bytes32 indexed hash, uint256 timestamp, address indexed submitter);

    /// kind: keccak256("bundle") | keccak256("decision") | keccak256("audit_head")
    function anchor(bytes32 kind, bytes32 hash) external {
        emit Anchored(kind, hash, block.timestamp, msg.sender);
    }
}
