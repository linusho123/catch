Feature: Holding
  A tap shows what Catch is holding for this conversation: a names page,
  then a promises page on a swipe down. A conversation ends after ten
  minutes in which the wearer does not speak, or at once on a long-press.
  Serves N3 and N4.

  @D43
  Scenario: A tap shows the names page
    Given in this conversation Priya, Marcus and Dana have each introduced themselves
    And the wearer has promised to send Dev the deck and to introduce Dev to Sam, and Dev has promised to send the agenda
    And the lens shows only the dot
    When the wearer taps the glasses
    Then the wearer sees a page headed "this conversation 1/2" listing "Priya", "Marcus" and "Dana" in that order
    And the wearer sees the hint "↓ promises" at the foot of the page

  @D43
  Scenario: A swipe down turns to the promises page
    Given the names page of a conversation with two promises made and one owed is showing
    When the wearer swipes down past the end of the names
    Then the wearer sees "send Dev the deck" and "introduce Dev to Sam" first
    And the wearer sees "owed: Dev sends the agenda" after them

  @D43
  Scenario: Thirty names scroll before the promises page
    Given in this conversation thirty people have introduced themselves in a circle
    And the wearer has promised to send Dev the deck
    When the wearer taps and then swipes down repeatedly
    Then the wearer sees all thirty names in the order heard across the swipes
    And the wearer sees the promises page only after the last name
    And a swipe up scrolls the wearer back through the names

  @D43 @D31
  Scenario Outline: A held page dismisses on its own
    Given <held> held in this conversation
    And the wearer has tapped and a page is showing
    When <after> pass with no touch
    Then the wearer sees the page <state>

    Examples:
      | held        | after     | state                                  |
      | three names | 4 seconds | still on the lens                      |
      | three names | 5 seconds | gone, with only the dot in its place   |
      | nothing     | 5 seconds | gone, with only the dot in its place   |

  @D31
  Scenario: Nothing held shows an empty page
    Given the wearer is in a conversation in which nobody has introduced themselves and nothing has been promised
    When the wearer taps the glasses
    Then the wearer sees one page reading "this conversation · nothing held"
    And the wearer sees it go back to the dot on the next tap

  @D55 @D56 @D92
  Scenario Outline: Quiet ends a conversation at ten minutes
    Given the wearer is talking with Dev, Priya has introduced herself, and the wearer has promised to send Dev the deck
    When the wearer says nothing for <silence> while Dev keeps talking, and then speaks again
    Then the wearer is in <which>
    And a tap shows <page>
    And the phone has received <phone>

    Examples:
      | silence                    | which                 | page                               | phone                                        |
      | nine minutes               | the same conversation | "Priya" on the names page          | nothing                                      |
      | ten minutes and one second | a new conversation    | "this conversation · nothing held" | the promise notification at the tenth minute |

  @D52
  Scenario: A long-press ends the conversation now
    Given the wearer is twenty minutes into a conversation with Dev in which the wearer promised to send the deck tonight
    And Priya introduced herself, and the wearer swiped up and tapped to keep the conversation
    When the wearer long-presses the glasses
    Then the phone shows the promise notification within thirty seconds
    And the phone shows the kept-conversation notification within thirty seconds
    And a tap shows "this conversation · nothing held"
    And the next thing the wearer says begins a new conversation
