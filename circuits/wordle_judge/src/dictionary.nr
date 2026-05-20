use poseidon::poseidon2::Poseidon2;

pub global TREE_HEIGHT: u32 = 14;

fn hash_pair(left: Field, right: Field) -> Field {
    Poseidon2::hash([left, right], 2)
}

/// Leaf = Poseidon2([l0..l4], 5), matching `scripts/merkle.ts`.
pub fn word_to_leaf(word: [u8; 5]) -> Field {
    Poseidon2::hash(
        [
            word[0] as Field,
            word[1] as Field,
            word[2] as Field,
            word[3] as Field,
            word[4] as Field,
        ],
        5,
    )
}

fn compute_root_from_sibling_path(
    leaf: Field,
    leaf_index: Field,
    sibling_path: [Field; TREE_HEIGHT],
) -> Field {
    let mut node = leaf;
    let indices: [bool; TREE_HEIGHT] = leaf_index.to_le_bits();

    for i in 0..TREE_HEIGHT {
        let (hash_left, hash_right) = if indices[i] {
            (sibling_path[i], node)
        } else {
            (node, sibling_path[i])
        };
        node = hash_pair(hash_left, hash_right);
    }
    node
}

pub fn assert_word_in_dictionary(
    word: [u8; 5],
    leaf_index: Field,
    sibling_path: [Field; TREE_HEIGHT],
    dictionary_root: Field,
) {
    let leaf = word_to_leaf(word);
    let computed = compute_root_from_sibling_path(leaf, leaf_index, sibling_path);
    assert(computed == dictionary_root);
}

#[test]
fn test_crane_dictionary_membership() {
    let crane = [2, 17, 0, 13, 4];
    let root = 0xf8b3c53c77682efa7abefa14985399da8579c59e34e9e7217dc7909f09a612b;
    let index = 2628;
    let path = [
        0x1231ead52163a7e37b8082a07f49e5af92c7c5d05338d890afcc73d4b6d2af38,
        0x71d0ad7c53892f04b8af68a96fb08d2093550a38902ca472c403ae7b00cd4c7,
        0x1b1e4c94034d3ea3d90f32155b4a983826a6f52eae159838bf291594d9a81953,
        0x2eafcae644a3c676abc45cf16acd738020c97bc772af9203823c5f24bec8a0e0,
        0x2cdfeec4090698b028d9cddbf797017642cba1a30c688770c45c5423c5b50f1e,
        0x213117539b09e4e37550d4802e41b8a62a5cdc77a2daaf4f26c8bc2d9f11141c,
        0x1e87647fa15e4cc285f4a90abf3a0749cc3e40c00a2d44f562187272f272590e,
        0x2add9c1ba429d1ce5786f07fe562b2c2181c32e6cacce011f86c3bca7803f705,
        0x972d680082675515667d26e786c878fdab1fb9fd66f15d46cbae8f51215d9a5,
        0x1053229c3338db3fbfadfbd198518d2837c889fcf4955076226aa43588862834,
        0x5759cdc67d0f8b2021512f725851aefc98f5e2e5ffb67a73db57e41922858b1,
        0xef4ddf9c892db1b060bc744b4dcfee8771f35f278ac305cc6412a27bcad94b8,
        0x28b5eefd22e328ea293fb24dbbfc3700a7d9aa3ea815482f80663660cc641a19,
        0x90876a5698a5c03e29de7500dbc2b19ddc37bf207a652956badeeaf23c08e6f,
    ];
    assert_word_in_dictionary(crane, index, path, root);
}
