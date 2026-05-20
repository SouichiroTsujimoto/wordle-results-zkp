// Step 3+4+5: Wordle judge + dictionary Merkle + answer hash commitment.

mod answer_hash;
mod dictionary;
use answer_hash::answer_to_hash;
use dictionary::{assert_word_in_dictionary, TREE_HEIGHT};

global MAX_GUESSES: u32 = 6;
global WORD_LEN: u32 = 5;

/// Official Wordle duplicate-letter rules:
/// 1) Mark greens (exact position matches), consuming answer slots.
/// 2) Left-to-right, mark yellow when an unused answer slot has the letter.
pub fn judge(guess: [u8; WORD_LEN], answer: [u8; WORD_LEN]) -> [u8; WORD_LEN] {
    let mut result = [0; WORD_LEN];
    let mut answer_used = [false; WORD_LEN];

    for i in 0..WORD_LEN {
        if guess[i] == answer[i] {
            result[i] = 2;
            answer_used[i] = true;
        }
    }

    for i in 0..WORD_LEN {
        if result[i] != 2 {
            let mut matched = false;
            for j in 0..WORD_LEN {
                let can_match = (matched == false) & (answer_used[j] == false) & (guess[i] == answer[j]);
                if can_match {
                    result[i] = 1;
                    answer_used[j] = true;
                    matched = true;
                }
            }
        }
    }

    result
}

fn assert_letter(v: u8) {
    assert(v <= 25);
}

fn assert_grid_cell(v: u8) {
    assert(v <= 2);
}

fn assert_word_not_equal(a: [u8; WORD_LEN], b: [u8; WORD_LEN]) {
    let mut same = true;
    for j in 0..WORD_LEN {
        if a[j] != b[j] {
            same = false;
        }
    }
    assert(same == false);
}

fn main(
    guesses: [[u8; WORD_LEN]; MAX_GUESSES],
    answer: [u8; WORD_LEN],
    num_guesses: pub u32,
    grid: pub [[u8; WORD_LEN]; MAX_GUESSES],
    dictionary_root: pub Field,
    answer_hash: pub Field,
    answer_index: Field,
    answer_path: [Field; TREE_HEIGHT],
    guess_indices: [Field; MAX_GUESSES],
    guess_paths: [[Field; TREE_HEIGHT]; MAX_GUESSES],
) {
    assert(num_guesses >= 1);
    assert(num_guesses <= MAX_GUESSES);

    for j in 0..WORD_LEN {
        assert_letter(answer[j]);
    }

    assert(answer_to_hash(answer) == answer_hash);
    assert_word_in_dictionary(answer, answer_index, answer_path, dictionary_root);

    for i in 0..MAX_GUESSES {
        for j in 0..WORD_LEN {
            assert_grid_cell(grid[i][j]);
        }

        if i < num_guesses {
            for j in 0..WORD_LEN {
                assert_letter(guesses[i][j]);
            }

            let computed = judge(guesses[i], answer);
            for j in 0..WORD_LEN {
                assert(computed[j] == grid[i][j]);
            }

            assert_word_in_dictionary(
                guesses[i],
                guess_indices[i],
                guess_paths[i],
                dictionary_root,
            );
        } else {
            for j in 0..WORD_LEN {
                assert(grid[i][j] == 0);
            }
        }
    }

    for j in 0..WORD_LEN {
        assert(guesses[num_guesses - 1][j] == answer[j]);
    }

    for i in 0..MAX_GUESSES {
        if i < num_guesses - 1 {
            assert_word_not_equal(guesses[i], answer);
        }
    }
}

// --- tests (judge logic only; dictionary integration tested via JS) ---

#[test]
fn test_all_green() {
    let word = [2, 17, 0, 13, 4];
    let grid_row = [2, 2, 2, 2, 2];
    let empty = [0, 0, 0, 0, 0];
    let grid = [grid_row, empty, empty, empty, empty, empty];
    let guesses = [word, empty, empty, empty, empty, empty];
    let _ = judge(guesses[0], word);
    for j in 0..WORD_LEN {
        assert(grid[0][j] == 2);
    }
}

#[test]
fn test_duplicate_letters_llama_alley() {
    let guess = [11, 11, 0, 12, 0];
    let answer = [0, 11, 11, 4, 24];
    let expected = [1, 2, 1, 0, 0];
    let got = judge(guess, answer);
    for i in 0..WORD_LEN {
        assert(got[i] == expected[i]);
    }
}

#[test]
fn test_two_guess_win() {
    let slate = [18, 11, 0, 19, 4];
    let crane = [2, 17, 0, 13, 4];
    let answer = crane;
    let row0 = judge(slate, answer);
    let row1 = [2, 2, 2, 2, 2];
    let empty = [0, 0, 0, 0, 0];
    let guesses = [slate, crane, empty, empty, empty, empty];
    let grid = [row0, row1, empty, empty, empty, empty];
    for j in 0..WORD_LEN {
        assert(judge(guesses[0], answer)[j] == grid[0][j]);
        assert(judge(guesses[1], answer)[j] == grid[1][j]);
    }
}

#[test]
fn test_eerie_where_duplicate_e() {
    let guess = [4, 4, 17, 8, 4];
    let answer = [22, 7, 4, 17, 4];
    let expected = [1, 0, 1, 0, 2];
    let got = judge(guess, answer);
    for i in 0..WORD_LEN {
        assert(got[i] == expected[i]);
    }
}
