from holocron.assets.tokens import best_token_for_creature


ASSETS = [
    {"id": "b1", "asset_type": "tokens", "name": "B1Droid", "url": "/assets/b1.png"},
    {"id": "droideka", "asset_type": "tokens", "name": "Droideka", "url": "/assets/droideka.png"},
    {"id": "clone", "asset_type": "tokens", "name": "CloneTrooperPhase1", "url": "/assets/clone.png"},
    {"id": "rancor-arf", "asset_type": "tokens", "name": "RancorBattalionARF", "url": "/assets/rancor-arf.png"},
    {"id": "shaak-ti", "asset_type": "tokens", "name": "ShaakTi", "url": "/assets/shaak-ti.png"},
    {"id": "b2ha", "asset_type": "tokens", "name": "B2HADroid", "url": "/assets/b2ha.png"},
    {"id": "buzz", "asset_type": "tokens", "name": "BuzzDroid", "url": "/assets/buzz.png"},
]


def test_battle_droid_matches_compact_pack_name():
    match = best_token_for_creature({"name": "B1 Battle Droid", "type": "droid"}, ASSETS)

    assert match["name"] == "B1Droid"
    assert match["match_reason"] == "name"


def test_destroyer_droid_matches_droideka_alias():
    match = best_token_for_creature({"name": "Destroyer Droid", "type": "droid"}, ASSETS)

    assert match["name"] == "Droideka"
    assert match["match_reason"] == "name"


def test_named_droid_variants_use_curated_aliases():
    assert best_token_for_creature({"name": "B2-Ha Super Battle Droid", "type": "droid"}, ASSETS)["name"] == "B2HADroid"
    assert best_token_for_creature({"name": "Pistoeka Sabotage Droid", "type": "droid"}, ASSETS)["name"] == "BuzzDroid"


def test_unrelated_creature_does_not_get_low_confidence_token():
    match = best_token_for_creature({"name": "Acklay", "type": "beast"}, ASSETS)

    assert match is None


def test_single_word_creature_does_not_match_named_character_or_unit():
    assert best_token_for_creature({"name": "Shaak", "type": "beast"}, ASSETS) is None
    assert best_token_for_creature({"name": "Rancor, Adult", "type": "beast"}, ASSETS) is None
