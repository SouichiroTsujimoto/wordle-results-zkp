// Step 2 smoke circuit: "I know x such that pedersen_hash([x]) == y".
// Public input: y (the hash). Private witness: x (the preimage).
fn main(x: Field, y: pub Field) {
    let computed = std::hash::pedersen_hash([x]);
    assert(computed == y);
}

#[test]
fn test_hash_self_consistent() {
    let x: Field = 42;
    let y = std::hash::pedersen_hash([x]);
    main(x, y);
}
