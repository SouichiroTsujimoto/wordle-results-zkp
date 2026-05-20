/// Pedersen hash of the 5 letter encodings (a=0..z=25).
/// Matches bb.js `pedersenHash({ inputs, hashIndex: 0 })`.
pub fn answer_to_hash(answer: [u8; 5]) -> Field {
    std::hash::pedersen_hash([
        answer[0] as Field,
        answer[1] as Field,
        answer[2] as Field,
        answer[3] as Field,
        answer[4] as Field,
    ])
}

#[test]
fn test_crane_answer_hash() {
    let crane = [2, 17, 0, 13, 4];
    let expected = 0x2e05ea2a7fed677afdea8f8b420ce4b4ce58fbf0d35aab64d9f3aaa4cebcda6f;
    assert(answer_to_hash(crane) == expected);
}
