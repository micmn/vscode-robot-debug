*** Settings ***
Library    String
Library    Collections

*** Keywords ***
Aux Keyword
    [Arguments]    ${aaa}    ${bbb}
    @{list}=    Create List
    Append To List    ${list}    ${aaa}    ${bbb}
    [Return]    ${list}

Another Aux Keyword
    [Arguments]    ${ccc}    ${ddd}
    @{list}=    Create List
    Append To List    ${list}    ${ccc}    ${ddd}
    [Return]    ${list}