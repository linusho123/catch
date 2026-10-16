Feature: The dropped thread
  If the wearer stops mid-sentence and someone else takes the floor,
  the wearer's last six words wait on the lens until the wearer speaks
  again or taps. A normal turn and a silent pause show nothing. Serves N5
  (pick my sentence back up) and N1.

  @D35 @D48 @D49 @D50
  Scenario Outline: Someone else takes the floor
    Given earlier in the conversation the wearer said "<before>"
    And the wearer then says "<run>" and stops mid-sentence
    When Dev begins speaking and keeps speaking for three seconds
    Then the wearer sees "<lens>" in dim text in the lower third of the lens
    And the wearer still sees it until the wearer speaks again

    Examples:
      | before                                                       | run                                                                        | lens                         |
      | nothing of note                                              | There are two reasons for this. The first is cost, and the second reason is | …and the second reason is    |
      | and that's why we chose it, with nobody speaking in between  | Well, the                                                                  | …we chose it. Well, the      |
      | and that's why we chose it, after which Dev said makes sense | Well, the                                                                  | …Well, the                   |

  @D33
  Scenario: A normal turn shows nothing
    Given the wearer finishes the complete sentence "and that's why we chose it"
    When Marcus starts talking a second and a half later and the wearer stays quiet while he talks
    Then the wearer sees only the dot

  @D36
  Scenario: Silence alone shows nothing
    Given the wearer stops mid-sentence at "and the second reason is" to find a word
    When three seconds pass with nobody else speaking
    Then the wearer sees only the dot
    And the wearer still sees only the dot however long the silence lasts

  @D35
  Scenario: The thread clears when the wearer resumes
    Given the line "…and the second reason is" is showing on the lens
    When the wearer says "the second reason is cost"
    Then the wearer sees only the dot

  @D34
  Scenario: A tap clears a line without opening the held page
    Given a dropped-thread line is showing on the lens
    When the wearer taps the glasses
    Then the wearer sees only the dot
    And the wearer does not see the held page

  @D120
  Scenario: With automatic detection off, a tap gives the thread back
    Given automatic cut-off detection is switched off
    And the wearer said "and the second reason is" and stopped mid-sentence, and Dev has taken the floor
    And the lens shows only the dot
    When the wearer taps the glasses
    Then the wearer sees the held page with "…and the second reason is" as its first line, above the names
