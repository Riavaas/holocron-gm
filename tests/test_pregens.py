from zipfile import ZipFile

from holocron.characters.pregens import list_pregens


def test_list_pregens_groups_zip_character_levels(tmp_path):
    archive = tmp_path / "PHB Pre Gens-test.zip"
    with ZipFile(archive, "w") as zip_file:
        zip_file.writestr("PHB Pre Gens/Rodian Fighter Assault Specialist/Level 1 Rodian Fighter.pdf", b"pdf")
        zip_file.writestr("PHB Pre Gens/Rodian Fighter Assault Specialist/Level 5 Rodian Fighter - Assault Specialist.pdf", b"pdf")

    pregens = list_pregens(tmp_path)

    assert len(pregens) == 1
    assert pregens[0]["name"] == "Rodian Fighter Assault Specialist"
    assert pregens[0]["species"] == "Rodian"
    assert pregens[0]["class"] == "Fighter"
    assert pregens[0]["subclass"] == "Assault Specialist"
    assert pregens[0]["max_level"] == 5
